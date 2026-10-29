"""Staff: applications, customers, plans, overview numbers and the audit log."""
from datetime import date
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Response
from psycopg import errors
from pydantic import BaseModel, Field

from app import db, events
from app.deps import (APP_URL, DB, PLAN_COLS, USER_COLS, Admin, Email, Limit, Money, Offset, Password, Text, paged,
                      send_email_quietly, update_row)
from app.routers.billing import issue_invoice

router = APIRouter()

InstallStatus = Literal["scheduled", "technician_assigned", "installed"]
INSTALL_MESSAGE = {
    "scheduled": "Your installation is booked.",
    "technician_assigned": "A technician has been assigned to your installation.",
    "installed": "Your internet is installed. Enjoy MyTerra!",
}


class NewUser(BaseModel):
    name: Text(100)
    email: Email
    password: Password
    role: Literal["customer", "admin"] = "customer"
    plan_id: UUID | None = None
    balance: Money = 0
    city: Text(60) | None = None


class UserChanges(BaseModel):
    name: Text(100) | None = None
    email: Email | None = None
    password: Password | None = None
    role: Literal["customer", "admin"] | None = None
    plan_id: UUID | None = None
    balance: Money | None = None
    active: bool | None = None
    city: Text(60) | None = None
    install_status: InstallStatus | None = None
    install_date: date | None = None


class NewPlan(BaseModel):
    name: Text(50)
    data_gb: int = Field(gt=0, le=100_000)
    speed_mbps: int = Field(100, gt=0, le=100_000)
    price: Money
    active: bool = True


class PlanChanges(BaseModel):
    name: Text(50) | None = None
    data_gb: int | None = Field(None, gt=0, le=100_000)
    speed_mbps: int | None = Field(None, gt=0, le=100_000)
    price: Money | None = None
    active: bool | None = None


# ---------- overview ----------

@router.get("/api/admin/overview")
def overview(_: Admin, conn: DB):
    kpis = conn.execute(
        "select (select count(*)::int from users where role = 'customer' and active) as active_customers, "
        "(select coalesce(sum(p.price), 0)::float8 from users u join plans p on p.id = u.plan_id "
        " where u.role = 'customer' and u.active) as mrr, "
        "(select coalesce(sum(amount), 0)::float8 from invoices where status = 'unpaid') as unpaid_total, "
        "(select count(*)::int from invoices where status = 'unpaid' and due_date < current_date) as overdue_invoices, "
        "(select count(*)::int from tickets where status <> 'resolved') as open_tickets, "
        "(select count(*)::int from applications where status = 'pending') as pending_applications, "
        "(select count(*)::int from outages where status <> 'resolved') as active_outages").fetchone()
    revenue = conn.execute(
        "select to_char(m, 'YYYY-MM') as month, coalesce(sum(p.amount), 0)::float8 as amount "
        "from generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), "
        "interval '1 month') m left join payments p on date_trunc('month', p.created_at) = m "
        "group by m order by m").fetchall()
    return {"kpis": kpis, "revenue": revenue,
            "audit": conn.execute("select * from audit_log order by created_at desc limit 8").fetchall()}


@router.get("/api/admin/audit")
def audit_log(_: Admin, conn: DB, response: Response, limit: Limit = 200, offset: Offset = 0):
    return paged(conn, response, "select * from audit_log order by created_at desc, id", (), limit, offset)


# ---------- applications ----------

@router.get("/api/admin/applications")
def list_applications(_: Admin, conn: DB, response: Response, limit: Limit = 500, offset: Offset = 0):
    return paged(conn, response, "select a.id, a.name, a.email, a.phone, a.birth_date, a.id_number, a.city, a.street, "
                        "a.apartment, a.install_date, a.card_brand, a.card_last4, a.amount_paid::float8 as amount_paid, "
                        "a.status, a.created_at, p.name as plan_name "
                        "from applications a join plans p on p.id = a.plan_id order by a.created_at desc, a.id", (), limit, offset)


@router.post("/api/admin/applications/{app_id}/approve")
def approve(app_id: UUID, admin: Admin, conn: DB):
    with conn.transaction():
        a = conn.execute("select a.*, p.name as plan_name from applications a join plans p on p.id = a.plan_id "
                         "where a.id = %s and a.status = 'pending' for update of a", (app_id,)).fetchone()
        if not a:
            raise HTTPException(404, "No pending application with this id")
        address = ", ".join(x for x in (a["street"], a["apartment"], a["city"]) if x)
        try:
            user_id = conn.execute(
                "insert into users (email, name, password_hash, plan_id, phone, address, city, install_status, "
                "install_date) values (%s, %s, %s, %s, %s, %s, %s, 'scheduled', %s) returning id",
                (a["email"], a["name"], a["password_hash"], a["plan_id"], a["phone"], address or None, a["city"],
                 a["install_date"])).fetchone()["id"]
        except errors.UniqueViolation:
            raise HTTPException(409, "An account with this email already exists") from None
        conn.execute("update applications set status = 'approved' where id = %s", (app_id,))
        if a["amount_paid"]:
            # The payment taken when applying covers the first month.
            inv = issue_invoice(conn, user_id, date.today().replace(day=1), a["plan_name"], a["amount_paid"], paid=True)
            conn.execute("insert into payments (user_id, invoice_id, kind, method, amount, card_brand, card_last4) "
                         "values (%s, %s, 'signup', 'card', %s, %s, %s)",
                         (user_id, inv["id"] if inv else None, a["amount_paid"], a["card_brand"], a["card_last4"]))
        install = f"{a['install_date']:%A %d %B %Y}" if a["install_date"] else "we'll call you to book a time"
        events.notify_user(conn, user_id, "installation", "Welcome to MyTerra",
                           f"Your installation is booked for {install}.", "/dashboard")
        events.audit(conn, admin, "approved application", a["email"])
    sent = send_email_quietly(a["email"], "Your MyTerra account is approved",
                              f"Hi {a['name']},\n\nGood news: your application is approved and your account is ready."
                              f"\n\nSign in: {APP_URL}/login\nEmail: {a['email']}\n"
                              "Password: the one you chose when you applied.\n\n"
                              f"Plan: {a['plan_name']}\nInstallation: {install}\n\nWelcome to MyTerra.")
    return {"user_id": str(user_id), "email_sent": sent}


@router.post("/api/admin/applications/{app_id}/reject")
def reject(app_id: UUID, admin: Admin, conn: DB):
    with conn.transaction():
        a = conn.execute("update applications set status = 'rejected' where id = %s and status = 'pending' "
                         "returning name, email, card_brand, card_last4, amount_paid::float8 as amount_paid",
                         (app_id,)).fetchone()
        if not a:
            raise HTTPException(404, "No pending application with this id")
        events.audit(conn, admin, "rejected application", a["email"])
    refund = (f"Your payment of ${a['amount_paid']:.2f} to your {a['card_brand']} ending in {a['card_last4']} "
              "has been refunded.\n\n") if a["amount_paid"] else ""
    sent = send_email_quietly(a["email"], "About your MyTerra application",
                              f"Hi {a['name']},\n\nWe're sorry, we can't approve your application right now.\n\n"
                              f"{refund}You're welcome to apply again later.\n\nMyTerra")
    return {"status": "rejected", "email_sent": sent}


# ---------- customers ----------

@router.get("/api/admin/users")
def list_users(_: Admin, conn: DB, response: Response, limit: Limit = 500, offset: Offset = 0):
    return paged(conn, response, f"select {USER_COLS}, p.name as plan_name, "
                        "(select coalesce(sum(i.amount), 0)::float8 from invoices i "
                        " where i.user_id = u.id and i.status = 'unpaid') as amount_due "
                        "from users u left join plans p on p.id = u.plan_id order by u.created_at, u.id", (), limit, offset)


@router.post("/api/admin/users", status_code=201)
def create_user(body: NewUser, admin: Admin, conn: DB):
    if body.role == "customer" and not body.plan_id:
        raise HTTPException(422, "Customers need a plan")
    try:
        with conn.transaction():
            row = conn.execute(
                "insert into users (email, name, password_hash, role, plan_id, balance, city) "
                "values (%s, %s, %s, %s, %s, %s, %s) returning id",
                (body.email, body.name, db.hash_password(body.password), body.role, body.plan_id, body.balance,
                 body.city)).fetchone()
            events.audit(conn, admin, f"added {body.role}", body.email)
        return row
    except errors.UniqueViolation:
        raise HTTPException(409, "An account with this email already exists") from None
    except errors.ForeignKeyViolation:
        raise HTTPException(422, "That plan does not exist") from None


@router.patch("/api/admin/users/{user_id}")
def update_user(user_id: UUID, body: UserChanges, admin: Admin, conn: DB):
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    if user_id == admin["id"] and (changes.get("active") is False or changes.get("role") == "customer"):
        raise HTTPException(400, "You can't deactivate or demote your own account")
    if "password" in changes:
        changes["password_hash"] = db.hash_password(changes.pop("password"))
    try:
        with conn.transaction():
            before = conn.execute("select install_status, role, plan_id from users where id = %s for update",
                                  (user_id,)).fetchone()
            if before and changes.get("role", before["role"]) == "customer" and not changes.get("plan_id", before["plan_id"]):
                raise HTTPException(422, "Customers need a plan. Choose one at the same time.")
            row = update_row(conn, "users", user_id, changes,
                             "id, email, name, role, plan_id, balance::float8 as balance, active, city, "
                             "install_status, install_date")
            if row:
                if changes.get("active") is False or "password_hash" in changes:
                    conn.execute("delete from tokens where user_id = %s", (user_id,))
                if "install_status" in changes and before["install_status"] != changes["install_status"]:
                    when = f" Date: {row['install_date']:%A %d %B}." if row["install_date"] else ""
                    events.notify_user(conn, user_id, "installation", INSTALL_MESSAGE[row["install_status"]],
                                       INSTALL_MESSAGE[row["install_status"]] + when, "/dashboard",
                                       email_to=row["email"])
                described = ", ".join(k.replace("_hash", "") for k in changes)
                events.audit(conn, admin, f"changed {described}", row["email"])
    except errors.UniqueViolation:
        raise HTTPException(409, "An account with this email already exists") from None
    except errors.ForeignKeyViolation:
        raise HTTPException(422, "That plan does not exist") from None
    if not row:
        raise HTTPException(404, "User not found")
    return row


@router.delete("/api/admin/users/{user_id}", status_code=204)
def delete_user(user_id: UUID, admin: Admin, conn: DB):
    if user_id == admin["id"]:
        raise HTTPException(400, "You can't delete your own account")
    with conn.transaction():
        gone = conn.execute("delete from users where id = %s returning email", (user_id,)).fetchone()
        if not gone:
            raise HTTPException(404, "User not found")
        events.audit(conn, admin, "deleted user", gone["email"])
    return Response(status_code=204)


# ---------- plans ----------

@router.get("/api/admin/plans")
def list_plans(_: Admin, conn: DB):
    return conn.execute(f"select {PLAN_COLS}, (select count(*) from users u where u.plan_id = plans.id)::int as users "
                        "from plans order by price").fetchall()


@router.post("/api/admin/plans", status_code=201)
def create_plan(body: NewPlan, admin: Admin, conn: DB):
    try:
        with conn.transaction():
            row = conn.execute(f"insert into plans (name, data_gb, speed_mbps, price, active) "
                               f"values (%s, %s, %s, %s, %s) returning {PLAN_COLS}",
                               (body.name, body.data_gb, body.speed_mbps, body.price, body.active)).fetchone()
            events.audit(conn, admin, "added plan", body.name)
        return row
    except errors.UniqueViolation:
        raise HTTPException(409, "A plan with this name already exists") from None


@router.patch("/api/admin/plans/{plan_id}")
def update_plan(plan_id: UUID, body: PlanChanges, admin: Admin, conn: DB):
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    try:
        with conn.transaction():
            row = update_row(conn, "plans", plan_id, changes, PLAN_COLS)
            if row and changes:
                events.audit(conn, admin, f"changed plan {', '.join(changes)}", row["name"])
    except errors.UniqueViolation:
        raise HTTPException(409, "A plan with this name already exists") from None
    if not row:
        raise HTTPException(404, "Plan not found")
    return row


@router.delete("/api/admin/plans/{plan_id}", status_code=204)
def delete_plan(plan_id: UUID, admin: Admin, conn: DB):
    try:
        with conn.transaction():
            gone = conn.execute("delete from plans where id = %s returning name", (plan_id,)).fetchone()
            if gone:
                events.audit(conn, admin, "deleted plan", gone["name"])
    except errors.ForeignKeyViolation:
        raise HTTPException(409, "This plan is used by customers or applications. Hide it instead.") from None
    if not gone:
        raise HTTPException(404, "Plan not found")
    return Response(status_code=204)
