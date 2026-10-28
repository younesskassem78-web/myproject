from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Response
from psycopg import errors
from pydantic import BaseModel, Field

from app import db
from app.deps import (APP_URL, send_email_quietly, DB, PLAN_COLS, USER_COLS, Admin, Email, Money, Password, Text, update_row)

router = APIRouter()

# ---------- admin ----------

class NewUser(BaseModel):
    name: Text(100)
    email: Email
    password: Password
    role: Literal["customer", "admin"] = "customer"
    plan_id: UUID | None = None
    balance: Money = 0


class UserChanges(BaseModel):
    name: Text(100) | None = None
    email: Email | None = None
    password: Password | None = None
    role: Literal["customer", "admin"] | None = None
    plan_id: UUID | None = None
    balance: Money | None = None
    active: bool | None = None


class NewPlan(BaseModel):
    name: Text(50)
    data_gb: int = Field(gt=0, le=100_000)
    price: Money
    active: bool = True


class PlanChanges(BaseModel):
    name: Text(50) | None = None
    data_gb: int | None = Field(None, gt=0, le=100_000)
    price: Money | None = None
    active: bool | None = None


class TicketChanges(BaseModel):
    status: Literal["open", "in_progress", "resolved"]


@router.get("/api/admin/applications")
def list_applications(_: Admin, conn: DB):
    return conn.execute("select a.id, a.name, a.email, a.phone, a.birth_date, a.id_number, a.city, a.street, "
                        "a.apartment, a.install_date, a.card_brand, a.card_last4, a.amount_paid::float8 as amount_paid, "
                        "a.status, a.created_at, p.name as plan_name "
                        "from applications a join plans p on p.id = a.plan_id order by a.created_at desc").fetchall()


@router.post("/api/admin/applications/{app_id}/approve")
def approve(app_id: UUID, _: Admin, conn: DB):
    with conn.transaction():
        a = conn.execute("select a.*, p.name as plan_name from applications a join plans p on p.id = a.plan_id "
                         "where a.id = %s and a.status = 'pending' for update of a", (app_id,)).fetchone()
        if not a:
            raise HTTPException(404, "No pending application with this id")
        address = ", ".join(x for x in (a["street"], a["apartment"], a["city"]) if x)
        try:
            user_id = conn.execute(
                "insert into users (email, name, password_hash, plan_id, phone, address) "
                "values (%s, %s, %s, %s, %s, %s) returning id",
                (a["email"], a["name"], a["password_hash"], a["plan_id"], a["phone"], address or None)).fetchone()["id"]
        except errors.UniqueViolation:
            raise HTTPException(409, "An account with this email already exists")
        conn.execute("update applications set status = 'approved' where id = %s", (app_id,))
    install = f"{a['install_date']:%A %d %B %Y}" if a["install_date"] else "we'll call you to book a time"
    sent = send_email_quietly(a["email"], "Your MyTerra account is approved",
                         f"Hi {a['name']},\n\nGood news: your application is approved and your account is ready.\n\n"
                         f"Sign in: {APP_URL}/login\nEmail: {a['email']}\n"
                         "Password: the one you chose when you applied.\n\n"
                         f"Plan: {a['plan_name']}\nInstallation: {install}\n\nWelcome to MyTerra.")
    return {"user_id": str(user_id), "email_sent": sent}


@router.post("/api/admin/applications/{app_id}/reject")
def reject(app_id: UUID, _: Admin, conn: DB):
    a = conn.execute("update applications set status = 'rejected' where id = %s and status = 'pending' "
                     "returning name, email, card_brand, card_last4, amount_paid::float8 as amount_paid",
                     (app_id,)).fetchone()
    if not a:
        raise HTTPException(404, "No pending application with this id")
    refund = (f"Your payment of ${a['amount_paid']:.2f} to your {a['card_brand']} ending in {a['card_last4']} "
              "has been refunded.\n\n") if a["amount_paid"] else ""
    sent = send_email_quietly(a["email"], "About your MyTerra application",
                         f"Hi {a['name']},\n\nWe're sorry, we can't approve your application right now.\n\n"
                         f"{refund}You're welcome to apply again later.\n\nMyTerra")
    return {"status": "rejected", "email_sent": sent}


@router.get("/api/admin/users")
def list_users(_: Admin, conn: DB):
    return conn.execute(f"select {USER_COLS}, p.name as plan_name from users u "
                        "left join plans p on p.id = u.plan_id order by u.created_at").fetchall()


@router.post("/api/admin/users", status_code=201)
def create_user(body: NewUser, _: Admin, conn: DB):
    if body.role == "customer" and not body.plan_id:
        raise HTTPException(422, "Customers need a plan")
    try:
        return conn.execute(
            "insert into users (email, name, password_hash, role, plan_id, balance) values (%s, %s, %s, %s, %s, %s) "
            "returning id", (body.email, body.name, db.hash_password(body.password), body.role, body.plan_id,
                             body.balance)).fetchone()
    except errors.UniqueViolation:
        raise HTTPException(409, "An account with this email already exists")
    except errors.ForeignKeyViolation:
        raise HTTPException(422, "That plan does not exist")


@router.patch("/api/admin/users/{user_id}")
def update_user(user_id: UUID, body: UserChanges, admin: Admin, conn: DB):
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    if user_id == admin["id"] and (changes.get("active") is False or changes.get("role") == "customer"):
        raise HTTPException(400, "You can't deactivate or demote your own account")
    if "password" in changes:
        changes["password_hash"] = db.hash_password(changes.pop("password"))
    try:
        with conn.transaction():
            row = update_row(conn, "users", user_id, changes,
                             "id, email, name, role, plan_id, balance::float8 as balance, active")
            if row and changes.get("active") is False:
                conn.execute("delete from tokens where user_id = %s", (user_id,))
    except errors.UniqueViolation:
        raise HTTPException(409, "An account with this email already exists")
    except errors.ForeignKeyViolation:
        raise HTTPException(422, "That plan does not exist")
    if not row:
        raise HTTPException(404, "User not found")
    return row


@router.delete("/api/admin/users/{user_id}", status_code=204)
def delete_user(user_id: UUID, admin: Admin, conn: DB):
    if user_id == admin["id"]:
        raise HTTPException(400, "You can't delete your own account")
    if not conn.execute("delete from users where id = %s returning id", (user_id,)).fetchone():
        raise HTTPException(404, "User not found")
    return Response(status_code=204)


@router.get("/api/admin/plans")
def list_plans(_: Admin, conn: DB):
    return conn.execute(f"select {PLAN_COLS}, (select count(*) from users u where u.plan_id = plans.id)::int as users "
                        "from plans order by price").fetchall()


@router.post("/api/admin/plans", status_code=201)
def create_plan(body: NewPlan, _: Admin, conn: DB):
    try:
        return conn.execute(f"insert into plans (name, data_gb, price, active) values (%s, %s, %s, %s) "
                            f"returning {PLAN_COLS}", (body.name, body.data_gb, body.price, body.active)).fetchone()
    except errors.UniqueViolation:
        raise HTTPException(409, "A plan with this name already exists")


@router.patch("/api/admin/plans/{plan_id}")
def update_plan(plan_id: UUID, body: PlanChanges, _: Admin, conn: DB):
    try:
        row = update_row(conn, "plans", plan_id, body.model_dump(exclude_unset=True, exclude_none=True), PLAN_COLS)
    except errors.UniqueViolation:
        raise HTTPException(409, "A plan with this name already exists")
    if not row:
        raise HTTPException(404, "Plan not found")
    return row


@router.delete("/api/admin/plans/{plan_id}", status_code=204)
def delete_plan(plan_id: UUID, _: Admin, conn: DB):
    try:
        deleted = conn.execute("delete from plans where id = %s returning id", (plan_id,)).fetchone()
    except errors.ForeignKeyViolation:
        raise HTTPException(409, "This plan is used by customers or applications. Deactivate it instead.")
    if not deleted:
        raise HTTPException(404, "Plan not found")
    return Response(status_code=204)


@router.get("/api/admin/tickets")
def list_all_tickets(_: Admin, conn: DB):
    return conn.execute("select t.id, t.subject, t.message, t.status, t.created_at, u.email as user_email, "
                        "u.name as user_name from tickets t join users u on u.id = t.user_id "
                        "order by t.created_at desc").fetchall()


@router.patch("/api/admin/tickets/{ticket_id}")
def update_ticket(ticket_id: UUID, body: TicketChanges, _: Admin, conn: DB):
    row = conn.execute("update tickets set status = %s where id = %s returning id, status",
                       (body.status, ticket_id)).fetchone()
    if not row:
        raise HTTPException(404, "Ticket not found")
    return row
