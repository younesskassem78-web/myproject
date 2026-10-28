import hashlib
import hmac
import logging
import os
import random
import re
import secrets
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Literal
from uuid import UUID

import psycopg
from fastapi import Depends, FastAPI, Header, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from psycopg import errors, sql
from pydantic import BaseModel, BeforeValidator, Field, StringConstraints, field_validator, model_validator

from app import db, notify

log = logging.getLogger("uvicorn.error")
APP_URL = os.environ.get("APP_URL", "http://localhost:4200")


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

USER_COLS = "u.id, u.email, u.name, u.phone, u.address, u.role, u.plan_id, u.balance::float8 as balance, u.active, u.created_at"
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


def _strip(chars: str):
    return BeforeValidator(lambda v: re.sub(f"[{chars}]", "", v) if isinstance(v, str) else v)


Phone = Annotated[str, _strip(r"\s\-()"), StringConstraints(pattern=r"^\+[1-9]\d{7,14}$")]


def luhn_ok(number: str) -> bool:
    digits = [int(d) for d in reversed(number)]
    return sum(digits[0::2] + [sum(divmod(2 * d, 10)) for d in digits[1::2]]) % 10 == 0


class Card(BaseModel):
    holder: Text(100)
    number: Annotated[str, _strip(r"\s\-"), StringConstraints(pattern=r"^\d{13,19}$")]
    expiry: Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^(0[1-9]|1[0-2])/\d{2}$")]
    cvc: Annotated[str, StringConstraints(pattern=r"^\d{3,4}$")]

    @model_validator(mode="after")
    def check(self):
        if not luhn_ok(self.number):
            raise ValueError("Card number is not valid")
        month, year = map(int, self.expiry.split("/"))
        if (2000 + year, month) < (date.today().year, date.today().month):
            raise ValueError("Card has expired")
        return self

    def brand(self) -> str:
        n = self.number
        if n[0] == "4":
            return "Visa"
        if 51 <= int(n[:2]) <= 55 or 2221 <= int(n[:4]) <= 2720:
            return "Mastercard"
        return "Amex" if n[:2] in ("34", "37") else "Card"


DECLINED_TEST_CARD = "4000000000000002"


class Apply(BaseModel):
    name: Text(100)
    email: Email
    phone: Phone
    password: Password
    birth_date: date
    id_number: Annotated[str, StringConstraints(strip_whitespace=True, min_length=5, max_length=30)]
    city: Text(60)
    street: Text(150)
    apartment: Annotated[str, StringConstraints(strip_whitespace=True, max_length=60)] = ""
    install_date: date
    plan_id: UUID
    accept_terms: bool
    card: Card
    email_verification_id: UUID
    phone_verification_id: UUID

    @field_validator("birth_date")
    @classmethod
    def adult(cls, v: date):
        t = date.today()
        if t.year - v.year - ((t.month, t.day) < (v.month, v.day)) < 18:
            raise ValueError("You must be 18 or older to apply")
        return v

    @field_validator("install_date")
    @classmethod
    def install_window(cls, v: date):
        if not date.today() < v <= date.today() + timedelta(days=60):
            raise ValueError("Pick an installation date in the next 60 days, starting tomorrow")
        return v

    @field_validator("accept_terms")
    @classmethod
    def terms(cls, v: bool):
        if not v:
            raise ValueError("You must accept the terms")
        return v


class VerifySend(BaseModel):
    channel: Literal["email", "sms"]
    target: str

    @model_validator(mode="after")
    def normalise(self):
        if self.channel == "email":
            self.target = self.target.strip().lower()
            if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", self.target):
                raise ValueError("Enter a valid email")
        else:
            self.target = re.sub(r"[\s\-()]", "", self.target)
            if not re.fullmatch(r"\+[1-9]\d{7,14}", self.target):
                raise ValueError("Enter your number with the country code, like +961 70 123 456")
        return self


class VerifyCheck(VerifySend):
    code: Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^\d{6}$")]


def _code_hash(vid: UUID, code: str) -> str:
    return hashlib.sha256(f"{vid}:{code}".encode()).hexdigest()


def _send_quietly(to: str, subject: str, body: str) -> bool:
    """Email whose failure must not undo the action that triggered it."""
    try:
        notify.send_email(to, subject, body)
        return True
    except Exception:
        log.exception("Email to %s failed", to)
        return False


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


@app.post("/api/verify/send")
def verify_send(body: VerifySend, conn: DB):
    if conn.execute("select 1 from verifications where channel = %s and target = %s and verified_at is null "
                    "and created_at > now() - interval '60 seconds'", (body.channel, body.target)).fetchone():
        raise HTTPException(429, "Wait a minute before asking for another code")
    code = f"{secrets.randbelow(10**6):06d}"
    vid = conn.execute("insert into verifications (channel, target, code_hash, expires_at) "
                       "values (%s, %s, '', now() + interval '10 minutes') returning id",
                       (body.channel, body.target)).fetchone()["id"]
    conn.execute("update verifications set code_hash = %s where id = %s", (_code_hash(vid, code), vid))
    text = f"Your MyTerra code is {code}. It expires in 10 minutes."
    try:
        if body.channel == "email":
            notify.send_email(body.target, "Your MyTerra verification code", text)
        else:
            notify.send_sms(body.target, text)
    except Exception:
        log.exception("Sending %s code to %s failed", body.channel, body.target)
        conn.execute("delete from verifications where id = %s", (vid,))
        what = "email" if body.channel == "email" else "SMS"
        raise HTTPException(502, f"We couldn't send the {what}. Check it and try again.")
    return {"sent": True}


@app.post("/api/verify/check")
def verify_check(body: VerifyCheck, conn: DB):
    row = conn.execute("select * from verifications where channel = %s and target = %s and used_at is null "
                       "order by created_at desc limit 1", (body.channel, body.target)).fetchone()
    if not row:
        raise HTTPException(400, "Ask for a code first")
    if row["verified_at"]:
        return {"verification_id": str(row["id"])}
    if row["attempts"] >= 5:
        raise HTTPException(400, "Too many wrong tries. Ask for a new code.")
    if row["expires_at"] < datetime.now(timezone.utc):
        raise HTTPException(400, "This code has expired. Ask for a new code.")
    if not hmac.compare_digest(row["code_hash"], _code_hash(row["id"], body.code)):
        conn.execute("update verifications set attempts = attempts + 1 where id = %s", (row["id"],))
        raise HTTPException(400, "Wrong code")
    conn.execute("update verifications set verified_at = now() where id = %s", (row["id"],))
    return {"verification_id": str(row["id"])}


def _use_verification(conn, vid: UUID, channel: str, target: str) -> None:
    if not conn.execute("update verifications set used_at = now() where id = %s and channel = %s and target = %s "
                        "and verified_at > now() - interval '30 minutes' and used_at is null returning id",
                        (vid, channel, target)).fetchone():
        what = "email" if channel == "email" else "phone number"
        raise HTTPException(400, f"Please verify your {what} first")


@app.post("/api/apply", status_code=201)
def apply(body: Apply, conn: DB):
    plan = conn.execute("select name, price::float8 as price from plans where id = %s and active",
                        (body.plan_id,)).fetchone()
    if not plan:
        raise HTTPException(422, "Choose a plan from the list")
    if conn.execute("select 1 from users where email = %s", (body.email,)).fetchone():
        raise HTTPException(409, "An account with this email already exists")
    with conn.transaction():  # a failed step below gives the verification codes back
        _use_verification(conn, body.email_verification_id, "email", body.email)
        _use_verification(conn, body.phone_verification_id, "sms", body.phone)
        # Fake payment: nothing is charged and only the brand and last 4 digits are stored.
        if body.card.number == DECLINED_TEST_CARD:
            raise HTTPException(402, "Your card was declined. Try another card.")
        try:
            row = conn.execute(
                "insert into applications (email, name, password_hash, plan_id, phone, birth_date, id_number, city, "
                "street, apartment, install_date, card_brand, card_last4, amount_paid) "
                "values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) returning id, status",
                (body.email, body.name, db.hash_password(body.password), body.plan_id, body.phone, body.birth_date,
                 body.id_number, body.city, body.street, body.apartment, body.install_date, body.card.brand(),
                 body.card.number[-4:], plan["price"])).fetchone()
        except errors.UniqueViolation:
            raise HTTPException(409, "You already applied with this email. Wait for approval.")
    _send_quietly(body.email, "We received your MyTerra application",
                  f"Hi {body.name},\n\nThanks for applying for {plan['name']}. We charged ${plan['price']:.2f} "
                  f"to your {body.card.brand()} ending in {body.card.number[-4:]} for the first month.\n\n"
                  "We'll email you as soon as your application is reviewed.\n\nMyTerra")
    return row


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
    return conn.execute("select a.id, a.name, a.email, a.phone, a.birth_date, a.id_number, a.city, a.street, "
                        "a.apartment, a.install_date, a.card_brand, a.card_last4, a.amount_paid::float8 as amount_paid, "
                        "a.status, a.created_at, p.name as plan_name "
                        "from applications a join plans p on p.id = a.plan_id order by a.created_at desc").fetchall()


@app.post("/api/admin/applications/{app_id}/approve")
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
    sent = _send_quietly(a["email"], "Your MyTerra account is approved",
                         f"Hi {a['name']},\n\nGood news: your application is approved and your account is ready.\n\n"
                         f"Sign in: {APP_URL}/login\nEmail: {a['email']}\n"
                         "Password: the one you chose when you applied.\n\n"
                         f"Plan: {a['plan_name']}\nInstallation: {install}\n\nWelcome to MyTerra.")
    return {"user_id": str(user_id), "email_sent": sent}


@app.post("/api/admin/applications/{app_id}/reject")
def reject(app_id: UUID, _: Admin, conn: DB):
    a = conn.execute("update applications set status = 'rejected' where id = %s and status = 'pending' "
                     "returning name, email, card_brand, card_last4, amount_paid::float8 as amount_paid",
                     (app_id,)).fetchone()
    if not a:
        raise HTTPException(404, "No pending application with this id")
    refund = (f"Your payment of ${a['amount_paid']:.2f} to your {a['card_brand']} ending in {a['card_last4']} "
              "has been refunded.\n\n") if a["amount_paid"] else ""
    sent = _send_quietly(a["email"], "About your MyTerra application",
                         f"Hi {a['name']},\n\nWe're sorry, we can't approve your application right now.\n\n"
                         f"{refund}You're welcome to apply again later.\n\nMyTerra")
    return {"status": "rejected", "email_sent": sent}


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
