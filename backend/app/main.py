import random
import secrets
from contextlib import asynccontextmanager
from datetime import date
from typing import Annotated, Literal
from uuid import UUID

import psycopg
from fastapi import Depends, FastAPI, Header, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from psycopg import errors, sql
from pydantic import BaseModel, Field, StringConstraints

from app import db


@asynccontextmanager
async def lifespan(_):
    db.init()
    yield


app = FastAPI(title="MyTerra API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:4200"],
                   allow_methods=["*"], allow_headers=["*"])

DB = Annotated[psycopg.Connection, Depends(db.get_db)]
Text = lambda n: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=n)]
Email = Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True, max_length=254,
                                         pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")]
Password = Annotated[str, StringConstraints(min_length=8, max_length=128)]
Money = Annotated[float, Field(ge=0, le=100_000)]

USER_COLS = "u.id, u.email, u.name, u.role, u.plan_id, u.balance::float8 as balance, u.active, u.created_at"
PLAN_COLS = "id, name, data_gb, price::float8 as price, active"


def current_user(conn: DB, authorization: str | None = Header(None)) -> dict:
    token = (authorization or "").removeprefix("Bearer ")
    user = conn.execute(f"select {USER_COLS} from tokens t join users u on u.id = t.user_id "
                        "where t.token = %s and u.active", (token,)).fetchone()
    if not user:
        raise HTTPException(401, "Not authenticated")
    return user


User = Annotated[dict, Depends(current_user)]


def admin_user(user: User) -> dict:
    if user["role"] != "admin":
        raise HTTPException(403, "Admins only")
    return user


Admin = Annotated[dict, Depends(admin_user)]


def daily_usage(email: str, today: date) -> list[dict]:
    """Fake but stable data use: same numbers every time for a given user and month."""
    rng = random.Random(f"{email}-{today:%Y-%m}")
    return [{"day": d, "gb": round(rng.uniform(0.3, 2.5), 2)} for d in range(1, today.day + 1)]


def update_row(conn, table: str, row_id: UUID, changes: dict, cols: str) -> dict:
    if not changes:
        return conn.execute(f"select {cols} from {table} where id = %s", (row_id,)).fetchone()
    sets = sql.SQL(", ").join(sql.SQL("{} = %s").format(sql.Identifier(k)) for k in changes)
    query = sql.SQL("update {} set {} where id = %s returning " + cols).format(sql.Identifier(table), sets)
    return conn.execute(query, (*changes.values(), row_id)).fetchone()


# ---------- public ----------

class Login(BaseModel):
    email: str
    password: str


class Apply(BaseModel):
    name: Text(100)
    email: Email
    password: Password
    plan_id: UUID


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/plans")
def plans(conn: DB):
    return conn.execute(f"select {PLAN_COLS} from plans where active order by price").fetchall()


@app.post("/api/login")
def login(body: Login, conn: DB):
    email = body.email.strip().lower()
    user = conn.execute("select id, name, role, active, password_hash from users where email = %s", (email,)).fetchone()
    if user and db.verify_password(body.password, user["password_hash"]):
        if not user["active"]:
            raise HTTPException(403, "Your account is deactivated. Contact support.")
        token = secrets.token_urlsafe(32)
        conn.execute("insert into tokens (token, user_id) values (%s, %s)", (token, user["id"]))
        return {"token": token, "name": user["name"], "role": user["role"]}
    application = conn.execute("select status, password_hash from applications where email = %s "
                               "order by created_at desc limit 1", (email,)).fetchone()
    if application and db.verify_password(body.password, application["password_hash"]):
        if application["status"] == "pending":
            raise HTTPException(403, "Your application is waiting for approval")
        if application["status"] == "rejected":
            raise HTTPException(403, "Your application was not approved")
    raise HTTPException(401, "Invalid email or password")


@app.post("/api/apply", status_code=201)
def apply(body: Apply, conn: DB):
    if not conn.execute("select 1 from plans where id = %s and active", (body.plan_id,)).fetchone():
        raise HTTPException(422, "Choose a plan from the list")
    if conn.execute("select 1 from users where email = %s", (body.email,)).fetchone():
        raise HTTPException(409, "An account with this email already exists")
    try:
        row = conn.execute("insert into applications (email, name, password_hash, plan_id) values (%s, %s, %s, %s) "
                           "returning id, status", (body.email, body.name, db.hash_password(body.password), body.plan_id))
    except errors.UniqueViolation:
        raise HTTPException(409, "You already applied with this email. Wait for approval.")
    return row.fetchone()


# ---------- customer ----------

class TopUp(BaseModel):
    amount: float = Field(gt=0, le=500)


class NewTicket(BaseModel):
    subject: Text(100)
    message: Text(1000)


@app.get("/api/me")
def me(user: User, conn: DB):
    plan = conn.execute(f"select {PLAN_COLS} from plans where id = %s", (user["plan_id"],)).fetchone()
    return {"id": user["id"], "name": user["name"], "email": user["email"], "role": user["role"],
            "balance": user["balance"], "plan": plan}


@app.get("/api/usage")
def usage(user: User, conn: DB):
    plan = conn.execute("select data_gb from plans where id = %s", (user["plan_id"],)).fetchone()
    if not plan:
        raise HTTPException(404, "No plan on this account")
    today = date.today()
    days = daily_usage(user["email"], today)
    return {"month": f"{today:%Y-%m}", "limit_gb": plan["data_gb"],
            "used_gb": round(sum(d["gb"] for d in days), 2), "days": days}


@app.post("/api/topup")
def topup(body: TopUp, user: User, conn: DB):
    return conn.execute("update users set balance = balance + %s where id = %s returning balance::float8 as balance",
                        (body.amount, user["id"])).fetchone()


@app.get("/api/tickets")
def tickets(user: User, conn: DB):
    return conn.execute("select id, subject, message, status, created_at from tickets "
                        "where user_id = %s order by created_at desc", (user["id"],)).fetchall()


@app.post("/api/tickets", status_code=201)
def create_ticket(body: NewTicket, user: User, conn: DB):
    return conn.execute("insert into tickets (user_id, subject, message) values (%s, %s, %s) "
                        "returning id, subject, message, status, created_at",
                        (user["id"], body.subject, body.message)).fetchone()


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


@app.get("/api/admin/applications")
def list_applications(_: Admin, conn: DB):
    return conn.execute("select a.id, a.name, a.email, a.status, a.created_at, p.name as plan_name "
                        "from applications a join plans p on p.id = a.plan_id order by a.created_at desc").fetchall()


@app.post("/api/admin/applications/{app_id}/approve")
def approve(app_id: UUID, _: Admin, conn: DB):
    with conn.transaction():
        a = conn.execute("select * from applications where id = %s and status = 'pending' for update",
                         (app_id,)).fetchone()
        if not a:
            raise HTTPException(404, "No pending application with this id")
        try:
            user_id = conn.execute("insert into users (email, name, password_hash, plan_id) values (%s, %s, %s, %s) "
                                   "returning id", (a["email"], a["name"], a["password_hash"], a["plan_id"])).fetchone()["id"]
        except errors.UniqueViolation:
            raise HTTPException(409, "An account with this email already exists")
        conn.execute("update applications set status = 'approved' where id = %s", (app_id,))
    return {"user_id": str(user_id)}


@app.post("/api/admin/applications/{app_id}/reject")
def reject(app_id: UUID, _: Admin, conn: DB):
    if not conn.execute("update applications set status = 'rejected' where id = %s and status = 'pending' returning id",
                        (app_id,)).fetchone():
        raise HTTPException(404, "No pending application with this id")
    return {"status": "rejected"}


@app.get("/api/admin/users")
def list_users(_: Admin, conn: DB):
    return conn.execute(f"select {USER_COLS}, p.name as plan_name from users u "
                        "left join plans p on p.id = u.plan_id order by u.created_at").fetchall()


@app.post("/api/admin/users", status_code=201)
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


@app.patch("/api/admin/users/{user_id}")
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


@app.delete("/api/admin/users/{user_id}", status_code=204)
def delete_user(user_id: UUID, admin: Admin, conn: DB):
    if user_id == admin["id"]:
        raise HTTPException(400, "You can't delete your own account")
    if not conn.execute("delete from users where id = %s returning id", (user_id,)).fetchone():
        raise HTTPException(404, "User not found")
    return Response(status_code=204)


@app.get("/api/admin/plans")
def list_plans(_: Admin, conn: DB):
    return conn.execute(f"select {PLAN_COLS}, (select count(*) from users u where u.plan_id = plans.id)::int as users "
                        "from plans order by price").fetchall()


@app.post("/api/admin/plans", status_code=201)
def create_plan(body: NewPlan, _: Admin, conn: DB):
    try:
        return conn.execute(f"insert into plans (name, data_gb, price, active) values (%s, %s, %s, %s) "
                            f"returning {PLAN_COLS}", (body.name, body.data_gb, body.price, body.active)).fetchone()
    except errors.UniqueViolation:
        raise HTTPException(409, "A plan with this name already exists")


@app.patch("/api/admin/plans/{plan_id}")
def update_plan(plan_id: UUID, body: PlanChanges, _: Admin, conn: DB):
    try:
        row = update_row(conn, "plans", plan_id, body.model_dump(exclude_unset=True, exclude_none=True), PLAN_COLS)
    except errors.UniqueViolation:
        raise HTTPException(409, "A plan with this name already exists")
    if not row:
        raise HTTPException(404, "Plan not found")
    return row


@app.delete("/api/admin/plans/{plan_id}", status_code=204)
def delete_plan(plan_id: UUID, _: Admin, conn: DB):
    try:
        deleted = conn.execute("delete from plans where id = %s returning id", (plan_id,)).fetchone()
    except errors.ForeignKeyViolation:
        raise HTTPException(409, "This plan is used by customers or applications. Deactivate it instead.")
    if not deleted:
        raise HTTPException(404, "Plan not found")
    return Response(status_code=204)


@app.get("/api/admin/tickets")
def list_all_tickets(_: Admin, conn: DB):
    return conn.execute("select t.id, t.subject, t.message, t.status, t.created_at, u.email as user_email, "
                        "u.name as user_name from tickets t join users u on u.id = t.user_id "
                        "order by t.created_at desc").fetchall()


@app.patch("/api/admin/tickets/{ticket_id}")
def update_ticket(ticket_id: UUID, body: TicketChanges, _: Admin, conn: DB):
    row = conn.execute("update tickets set status = %s where id = %s returning id, status",
                       (body.status, ticket_id)).fetchone()
    if not row:
        raise HTTPException(404, "Ticket not found")
    return row
