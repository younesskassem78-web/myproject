"""Shared types, database dependency and auth checks used by every router."""
import logging
import re
import os
import random
from datetime import date
from typing import Annotated
from uuid import UUID

import psycopg
from fastapi import Depends, Header, HTTPException, Query
from psycopg import sql
from pydantic import BaseModel, BeforeValidator, Field, StringConstraints, model_validator

from app import db, notify

log = logging.getLogger("uvicorn.error")
APP_URL = os.environ.get("APP_URL", "http://localhost:4200")


DB = Annotated[psycopg.Connection, Depends(db.get_db)]
Text = lambda n: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=n)]
Email = Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True, max_length=254,
                                         pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")]
Password = Annotated[str, StringConstraints(min_length=8, max_length=128)]
Money = Annotated[float, Field(ge=0, le=100_000)]

USER_COLS = ("u.id, u.email, u.name, u.phone, u.address, u.city, u.role, u.plan_id, u.balance::float8 as balance, "
             "u.active, u.created_at, u.autopay, u.card_brand, u.card_last4, u.install_status, u.install_date")
PLAN_COLS = "id, name, data_gb, speed_mbps, price::float8 as price, active"


def current_user(conn: DB, authorization: str | None = Header(None)) -> dict:
    token = (authorization or "").removeprefix("Bearer ")
    user = conn.execute(f"select {USER_COLS} from tokens t join users u on u.id = t.user_id "
                        "where t.token = %s and t.expires_at > now() and u.active", (token,)).fetchone()
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


def charge_card(card: Card) -> None:
    """Fake card processor: every valid card is approved except the declined test number."""
    if card.number == DECLINED_TEST_CARD:
        raise HTTPException(402, "Your card was declined. Try another card.")


Limit = Annotated[int, Query(ge=1, le=1000)]
Offset = Annotated[int, Query(ge=0)]


def paged(conn, response, query: str, params: tuple = (), limit: int = 500, offset: int = 0) -> list:
    """Run `query` one page at a time; the full count goes in the X-Total-Count header."""
    total = conn.execute(f"select count(*)::int as n from ({query}) q", params).fetchone()["n"]
    response.headers["X-Total-Count"] = str(total)
    return conn.execute(f"{query} limit %s offset %s", (*params, limit, offset)).fetchall()
