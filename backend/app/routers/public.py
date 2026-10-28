import hashlib
import hmac
import re
import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException
from psycopg import errors
from pydantic import BaseModel, BeforeValidator, StringConstraints, field_validator, model_validator

from app import db, notify
from app.deps import (send_email_quietly, DB, PLAN_COLS, Email, Password, Text, log)

router = APIRouter()

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


@router.get("/api/health")
def health():
    return {"status": "ok"}


@router.get("/api/plans")
def plans(conn: DB):
    return conn.execute(f"select {PLAN_COLS} from plans where active order by price").fetchall()


@router.post("/api/login")
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


@router.post("/api/verify/send")
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


@router.post("/api/verify/check")
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
            raise HTTPException(409, "You already applied with this email. Wait for approval.")
    send_email_quietly(body.email, "We received your MyTerra application",
                  f"Hi {body.name},\n\nThanks for applying for {plan['name']}. We charged ${plan['price']:.2f} "
                  f"to your {body.card.brand()} ending in {body.card.number[-4:]} for the first month.\n\n"
                  "We'll email you as soon as your application is reviewed.\n\nMyTerra")
    return row


