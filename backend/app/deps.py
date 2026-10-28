"""Shared types, database dependency and auth checks used by every router."""
import logging
import os
import random
from datetime import date
from typing import Annotated
from uuid import UUID

import psycopg
from fastapi import Depends, Header, HTTPException
from psycopg import sql
from pydantic import Field, StringConstraints

from app import db, notify

log = logging.getLogger("uvicorn.error")
APP_URL = os.environ.get("APP_URL", "http://localhost:4200")


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


def send_email_quietly(to: str, subject: str, body: str) -> bool:
    """Email whose failure must not undo the action that triggered it."""
    try:
        notify.send_email(to, subject, body)
        return True
    except Exception:
        log.exception("Email to %s failed", to)
        return False
