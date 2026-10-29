import hashlib
import hmac
import os
import re
import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Response
from fastapi.responses import JSONResponse
from psycopg import errors
from pydantic import BaseModel, StringConstraints, field_validator, model_validator

from app import db, notify
from app.deps import (DB, DECLINED_TEST_CARD, PLAN_COLS, Card, Email, Password, Phone, Text, log,
                      send_email_quietly)

router = APIRouter()

# ---------- public ----------

class Login(BaseModel):
    email: str
    password: str


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
            # No ":" so a public request can never address the internal "reset:<email>" codes.
            if ":" in self.target or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", self.target):
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


@router.get("/api/health")
def health():
    """For load balancers and uptime checks: is the API up and can it reach the database?"""
    try:
        with db.pool().connection() as conn:
            conn.execute("select 1")
    except Exception:
        log.exception("Health check: database unreachable")
        return JSONResponse({"status": "degraded", "database": "unreachable"}, status_code=503)
    return {"status": "ok", "database": "ok"}


@router.get("/api/plans")
def plans(conn: DB):
    return conn.execute(f"select {PLAN_COLS} from plans where active order by price").fetchall()


LOCK_AFTER = 5  # wrong passwords within 15 minutes


@router.post("/api/login")
def login(body: Login, conn: DB):
    email = body.email.strip().lower()
    fails = conn.execute("select count(*)::int as n from login_failures where email = %s "
                         "and created_at > now() - interval '15 minutes'", (email,)).fetchone()["n"]
    if fails >= LOCK_AFTER:
        raise HTTPException(429, "Too many wrong passwords. Try again in 15 minutes or reset your password.")
    user = conn.execute("select id, name, role, active, password_hash from users where email = %s", (email,)).fetchone()
    if user and db.verify_password(body.password, user["password_hash"]):
        if not user["active"]:
            raise HTTPException(403, "Your account is deactivated. Contact support.")
        token = secrets.token_urlsafe(32)
        conn.execute("delete from login_failures where email = %s", (email,))
        if db.needs_rehash(user["password_hash"]):
            conn.execute("update users set password_hash = %s where id = %s",
                         (db.hash_password(body.password), user["id"]))
        conn.execute("delete from tokens where expires_at < now()")  # tidy up old sessions
        conn.execute("insert into tokens (token, user_id) values (%s, %s)", (token, user["id"]))
        return {"token": token, "name": user["name"], "role": user["role"]}
    application = conn.execute("select status, password_hash from applications where email = %s "
                               "order by created_at desc limit 1", (email,)).fetchone()
    if application and db.verify_password(body.password, application["password_hash"]):
        if application["status"] == "pending":
            raise HTTPException(403, "Your application is waiting for approval")
        if application["status"] == "rejected":
            raise HTTPException(403, "Your application was not approved")
    conn.execute("insert into login_failures (email) values (%s)", (email,))
    raise HTTPException(401, "Invalid email or password")


@router.post("/api/logout", status_code=204)
def logout(conn: DB, authorization: str | None = Header(None)):
    conn.execute("delete from tokens where token = %s", ((authorization or "").removeprefix("Bearer "),))
    return Response(status_code=204)


def _issue_code(conn, channel: str, target: str, send) -> str:
    """Create a 6-digit code for `target`, deliver it with `send(text)` and return it."""
    if conn.execute("select 1 from verifications where channel = %s and target = %s and verified_at is null "
                    "and created_at > now() - interval '60 seconds'", (channel, target)).fetchone():
        raise HTTPException(429, "Wait a minute before asking for another code")
    code = f"{secrets.randbelow(10**6):06d}"
    vid = conn.execute("insert into verifications (channel, target, code_hash, expires_at) "
                       "values (%s, %s, '', now() + interval '10 minutes') returning id", (channel, target)).fetchone()["id"]
    conn.execute("update verifications set code_hash = %s where id = %s", (_code_hash(vid, code), vid))
    try:
        send(f"Your MyTerra code is {code}. It expires in 10 minutes.")
    except Exception:
        log.exception("Sending %s code to %s failed", channel, target)
        conn.execute("delete from verifications where id = %s", (vid,))
        what = "email" if channel == "email" else "SMS"
        raise HTTPException(502, f"We couldn't send the {what}. Check it and try again.") from None
    return code


def _check_code(conn, channel: str, target: str, code: str) -> UUID:
    row = conn.execute("select * from verifications where channel = %s and target = %s and used_at is null "
                       "order by created_at desc limit 1", (channel, target)).fetchone()
    if not row:
        raise HTTPException(400, "Ask for a code first")
    if row["verified_at"]:
        return row["id"]
    if row["attempts"] >= 5:
        raise HTTPException(400, "Too many wrong tries. Ask for a new code.")
    if row["expires_at"] < datetime.now(timezone.utc):
        raise HTTPException(400, "This code has expired. Ask for a new code.")
    if not hmac.compare_digest(row["code_hash"], _code_hash(row["id"], code)):
        conn.execute("update verifications set attempts = attempts + 1 where id = %s", (row["id"],))
        raise HTTPException(400, "Wrong code")
    conn.execute("update verifications set verified_at = now() where id = %s", (row["id"],))
    return row["id"]


@router.post("/api/verify/send")
def verify_send(body: VerifySend, conn: DB):
    if body.channel == "email":
        code = _issue_code(conn, "email", body.target,
                           lambda text: notify.send_email(body.target, "Your MyTerra verification code", text))
        live = notify.email_is_live()
    else:
        code = _issue_code(conn, "sms", body.target, lambda text: notify.send_sms(body.target, text))
        live = notify.sms_is_live()
    # Demo mode only: with no email/SMS service connected nobody could receive the code, so show it on screen.
    # Never in production, and never for password-reset codes (those would let anyone take over an account).
    if not live and os.environ.get("APP_ENV", "development") != "production":
        return {"sent": True, "demo_code": code}
    return {"sent": True}


@router.post("/api/verify/check")
def verify_check(body: VerifyCheck, conn: DB):
    return {"verification_id": str(_check_code(conn, body.channel, body.target, body.code))}


class Forgot(BaseModel):
    email: Email


class Reset(Forgot):
    code: Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^\d{6}$")]
    password: Password


# Reset codes live beside signup codes but under their own target, so one can never stand in for the other.
def _reset_target(email: str) -> str:
    return f"reset:{email}"


@router.post("/api/password/forgot")
def forgot(body: Forgot, conn: DB):
    # Same answer whether or not the account exists, so this can't be used to discover customers.
    if conn.execute("select 1 from users where email = %s and active", (body.email,)).fetchone():
        try:
            _issue_code(conn, "email", _reset_target(body.email),
                        lambda text: notify.send_email(body.email, "Reset your MyTerra password", text))
        except HTTPException as e:
            if e.status_code != 429:
                raise
    return {"sent": True}


@router.post("/api/password/reset")
def reset(body: Reset, conn: DB):
    target = _reset_target(body.email)
    with conn.transaction():
        vid = _check_code(conn, "email", target, body.code)
        user = conn.execute("update users set password_hash = %s where email = %s returning id",
                            (db.hash_password(body.password), body.email)).fetchone()
        if not user:
            raise HTTPException(400, "Ask for a code first")
        conn.execute("update verifications set used_at = now() where id = %s", (vid,))
        conn.execute("delete from tokens where user_id = %s", (user["id"],))
        conn.execute("delete from login_failures where email = %s", (body.email,))
    return {"reset": True}


def _use_verification(conn, vid: UUID, channel: str, target: str) -> None:
    if not conn.execute("update verifications set used_at = now() where id = %s and channel = %s and target = %s "
                        "and verified_at > now() - interval '30 minutes' and used_at is null returning id",
                        (vid, channel, target)).fetchone():
        what = "email" if channel == "email" else "phone number"
        raise HTTPException(400, f"Please verify your {what} first")


@router.post("/api/apply", status_code=201)
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
            raise HTTPException(409, "You already applied with this email. Wait for approval.") from None
    send_email_quietly(body.email, "We received your MyTerra application",
                  f"Hi {body.name},\n\nThanks for applying for {plan['name']}. We charged ${plan['price']:.2f} "
                  f"to your {body.card.brand()} ending in {body.card.number[-4:]} for the first month.\n\n"
                  "We'll email you as soon as your application is reviewed.\n\nMyTerra")
    return row


