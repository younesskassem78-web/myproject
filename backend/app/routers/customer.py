from datetime import date

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.deps import (DB, PLAN_COLS, Text, User, daily_usage)

router = APIRouter()

# ---------- customer ----------

class TopUp(BaseModel):
    amount: float = Field(gt=0, le=500)


class NewTicket(BaseModel):
    subject: Text(100)
    message: Text(1000)


@router.get("/api/me")
def me(user: User, conn: DB):
    plan = conn.execute(f"select {PLAN_COLS} from plans where id = %s", (user["plan_id"],)).fetchone()
    return {"id": user["id"], "name": user["name"], "email": user["email"], "role": user["role"],
            "balance": user["balance"], "plan": plan}


@router.get("/api/usage")
def usage(user: User, conn: DB):
    plan = conn.execute("select data_gb from plans where id = %s", (user["plan_id"],)).fetchone()
    if not plan:
        raise HTTPException(404, "No plan on this account")
    today = date.today()
    days = daily_usage(user["email"], today)
    return {"month": f"{today:%Y-%m}", "limit_gb": plan["data_gb"],
            "used_gb": round(sum(d["gb"] for d in days), 2), "days": days}


@router.post("/api/topup")
def topup(body: TopUp, user: User, conn: DB):
    return conn.execute("update users set balance = balance + %s where id = %s returning balance::float8 as balance",
                        (body.amount, user["id"])).fetchone()


@router.get("/api/tickets")
def tickets(user: User, conn: DB):
    return conn.execute("select id, subject, message, status, created_at from tickets "
                        "where user_id = %s order by created_at desc", (user["id"],)).fetchall()


@router.post("/api/tickets", status_code=201)
def create_ticket(body: NewTicket, user: User, conn: DB):
    return conn.execute("insert into tickets (user_id, subject, message) values (%s, %s, %s) "
                        "returning id, subject, message, status, created_at",
                        (user["id"], body.subject, body.message)).fetchone()


