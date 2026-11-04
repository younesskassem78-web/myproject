"""Two-step sign-in: a password plus a 6-digit code from an authenticator app (or a one-time recovery code)."""
import hashlib
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, StringConstraints

from app import db, events, totp
from app.deps import DB, Admin, User
from app.routers.public import issue_session

router = APIRouter()
Code = Annotated[str, StringConstraints(strip_whitespace=True, min_length=6, max_length=12)]


def _recovery_hash(user_id, code: str) -> str:
    # Recovery codes are random (about 40 bits each), so a per-user SHA-256 is enough: they can't be guessed.
    return hashlib.sha256(f"{user_id}:{code.strip().lower()}".encode()).hexdigest()


def _check(conn, user: dict, code: str) -> bool:
    """True for a fresh authenticator code or an unused recovery code (which is then used up)."""
    step = totp.verify(user["totp_secret"], code, user["totp_last_step"])
    if step is not None:
        conn.execute("update users set totp_last_step = %s where id = %s", (step, user["id"]))
        return True
    hashed = _recovery_hash(user["id"], code)
    return bool(conn.execute("update users set totp_recovery = array_remove(totp_recovery, %s) "
                             "where id = %s and %s = any(totp_recovery) returning id", (hashed, user["id"], hashed)).fetchone())


def _two_factor(conn, user_id) -> dict:
    return conn.execute("select id, email, role, password_hash, totp_secret, totp_enabled_at, totp_last_step, "
                        "cardinality(totp_recovery) as recovery_left from users where id = %s", (user_id,)).fetchone()


@router.get("/api/account/2fa")
def status(user: User, conn: DB):
    u = _two_factor(conn, user["id"])
    return {"enabled": bool(u["totp_enabled_at"]), "enabled_at": u["totp_enabled_at"], "recovery_left": u["recovery_left"]}


@router.post("/api/account/2fa/setup")
def setup(user: User, conn: DB):
    """A new secret to add to the authenticator app. Nothing changes until a code from it is confirmed."""
    if _two_factor(conn, user["id"])["totp_enabled_at"]:
        raise HTTPException(409, "Two-step sign-in is already on")
    secret = totp.new_secret()
    conn.execute("update users set totp_secret = %s where id = %s", (secret, user["id"]))
    return {"secret": secret, "uri": totp.setup_uri(secret, user["email"])}


class Confirm(BaseModel):
    code: Code


@router.post("/api/account/2fa/enable")
def enable(body: Confirm, user: User, conn: DB):
    u = _two_factor(conn, user["id"])
    if u["totp_enabled_at"]:
        raise HTTPException(409, "Two-step sign-in is already on")
    if not u["totp_secret"]:
        raise HTTPException(400, "Start the setup first")
    step = totp.verify(u["totp_secret"], body.code)
    if step is None:
        raise HTTPException(400, "That code doesn't match. Check the time on your phone and try the newest code.")
    codes = totp.recovery_codes()
    with conn.transaction():
        conn.execute("update users set totp_enabled_at = now(), totp_last_step = %s, totp_recovery = %s where id = %s",
                     (step, [_recovery_hash(user["id"], c) for c in codes], user["id"]))
        events.notify_user(conn, user["id"], "security", "Two-step sign-in is on",
                           "Signing in now needs a code from your authenticator app.", "/settings")
    return {"recovery_codes": codes}


class Disable(BaseModel):
    password: str
    code: Code


@router.post("/api/account/2fa/disable")
def disable(body: Disable, user: User, conn: DB):
    u = _two_factor(conn, user["id"])
    if not u["totp_enabled_at"]:
        raise HTTPException(409, "Two-step sign-in is already off")
    if not db.verify_password(body.password, u["password_hash"]) or not _check(conn, u, body.code):
        raise HTTPException(400, "The password or code isn't right")
    conn.execute("update users set totp_secret = null, totp_enabled_at = null, totp_last_step = null, "
                 "totp_recovery = '{}' where id = %s", (user["id"],))
    events.notify_user(conn, user["id"], "security", "Two-step sign-in is off",
                       "Signing in needs only your password now. If this wasn't you, change your password.", "/settings")
    return {"enabled": False}


class SecondStep(BaseModel):
    challenge: UUID
    code: Code


@router.post("/api/login/2fa")
def login_second_step(body: SecondStep, conn: DB, request: Request):
    c = conn.execute("select user_id, attempts from login_challenges where id = %s and expires_at > now()",
                     (body.challenge,)).fetchone()
    if not c:
        raise HTTPException(400, "This sign-in has expired. Enter your email and password again.")
    if c["attempts"] >= 5:
        conn.execute("delete from login_challenges where id = %s", (body.challenge,))
        raise HTTPException(429, "Too many wrong codes. Enter your email and password again.")
    if not _check(conn, _two_factor(conn, c["user_id"]), body.code):
        conn.execute("update login_challenges set attempts = attempts + 1 where id = %s", (body.challenge,))
        raise HTTPException(400, "Wrong code")
    conn.execute("delete from login_challenges where id = %s", (body.challenge,))
    user = conn.execute("select id, name, role from users where id = %s", (c["user_id"],)).fetchone()
    return issue_session(conn, user, request)


@router.post("/api/admin/users/{user_id}/2fa/reset")
def reset_for_user(user_id: UUID, admin: Admin, conn: DB):
    """For someone who lost their phone and their recovery codes; signs them out everywhere."""
    row = conn.execute("update users set totp_secret = null, totp_enabled_at = null, totp_last_step = null, "
                       "totp_recovery = '{}' where id = %s returning email", (user_id,)).fetchone()
    if not row:
        raise HTTPException(404, "User not found")
    conn.execute("delete from tokens where user_id = %s", (user_id,))
    events.audit(conn, admin, "reset two-step sign-in", row["email"])
    return {"reset": True}
