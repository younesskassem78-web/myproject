"""Signed-in customer: account, data use, top-ups, plan changes, password, notifications."""
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Response
from pydantic import BaseModel, Field

from app import db, events
from app.deps import DB, PLAN_COLS, Card, Password, User, charge_card, daily_usage

router = APIRouter()

OUTAGE_COLS = "id, city, title, message, status, started_at, updated_at, resolved_at"


@router.get("/api/me")
def me(user: User, conn: DB):
    plan = conn.execute(f"select {PLAN_COLS} from plans where id = %s", (user["plan_id"],)).fetchone()
    outages = conn.execute(f"select {OUTAGE_COLS} from outages where status <> 'resolved' and lower(city) = lower(%s) "
                           "order by started_at desc", (user["city"] or "",)).fetchall()
    keys = ("id", "name", "email", "phone", "address", "city", "role", "balance", "autopay", "card_brand",
            "card_last4", "install_status", "install_date")
    return {**{k: user[k] for k in keys}, "plan": plan, "outages": outages}


def check_usage_alerts(conn, user_id: UUID, used: float, limit: float, month: str) -> None:
    """Warn at 80% and 100% of the monthly data, once per level per month."""
    reached = [level for level in (80, 100) if used >= limit * level / 100]
    new = [r["level"] for r in (conn.execute(
        "insert into usage_alerts (user_id, month, level) values (%s, %s, %s) on conflict do nothing returning level",
        (user_id, month, level)).fetchone() for level in reached) if r]
    if 100 in new:
        events.notify_user(conn, user_id, "usage", "You've used all your data this month",
                           f"You've used {used:.1f} GB of {limit:g} GB. Upgrade your plan to avoid slowdowns.", "/plan")
    elif 80 in new:
        events.notify_user(conn, user_id, "usage", "You've used 80% of your data",
                           f"You've used {used:.1f} GB of {limit:g} GB this month.", "/dashboard")


@router.get("/api/usage")
def usage(user: User, conn: DB):
    plan = conn.execute("select data_gb from plans where id = %s", (user["plan_id"],)).fetchone()
    if not plan:
        raise HTTPException(404, "No plan on this account")
    today = date.today()
    days = daily_usage(user["email"], today)
    used = round(sum(d["gb"] for d in days), 2)
    check_usage_alerts(conn, user["id"], used, plan["data_gb"], f"{today:%Y-%m}")
    return {"month": f"{today:%Y-%m}", "limit_gb": plan["data_gb"], "used_gb": used, "days": days}


class TopUp(BaseModel):
    amount: float = Field(gt=0, le=500)
    card: Card


@router.post("/api/topup")
def topup(body: TopUp, user: User, conn: DB):
    charge_card(body.card)
    with conn.transaction():
        row = conn.execute("update users set balance = balance + %s where id = %s "
                           "returning balance::float8 as balance", (body.amount, user["id"])).fetchone()
        conn.execute("insert into payments (user_id, kind, method, amount, card_brand, card_last4) "
                     "values (%s, 'topup', 'card', %s, %s, %s)",
                     (user["id"], body.amount, body.card.brand(), body.card.number[-4:]))
    return row


class PlanChange(BaseModel):
    plan_id: UUID


@router.post("/api/plan")
def change_plan(body: PlanChange, user: User, conn: DB):
    plan = conn.execute(f"select {PLAN_COLS} from plans where id = %s and active", (body.plan_id,)).fetchone()
    if not plan:
        raise HTTPException(422, "Choose a plan from the list")
    if plan["id"] == user["plan_id"]:
        raise HTTPException(400, "You're already on this plan")
    conn.execute("update users set plan_id = %s where id = %s", (plan["id"], user["id"]))
    events.notify_user(conn, user["id"], "plan", f"You're now on {plan['name']}",
                       f"Your plan changed today. Your next bill will be ${plan['price']:.2f} a month.", "/plan")
    return plan


class PasswordChange(BaseModel):
    current: str
    password: Password


@router.post("/api/account/password")
def change_password(body: PasswordChange, user: User, conn: DB, authorization: str | None = Header(None)):
    row = conn.execute("select password_hash from users where id = %s", (user["id"],)).fetchone()
    if not db.verify_password(body.current, row["password_hash"]):
        raise HTTPException(400, "Your current password is wrong")
    token = (authorization or "").removeprefix("Bearer ")
    with conn.transaction():
        conn.execute("update users set password_hash = %s where id = %s", (db.hash_password(body.password), user["id"]))
        conn.execute("delete from tokens where user_id = %s and token <> %s", (user["id"], token))  # sign out elsewhere
    return {"changed": True}


@router.get("/api/notifications")
def notifications(user: User, conn: DB):
    items = conn.execute("select id, kind, title, body, link, created_at, read_at from notifications "
                         "where user_id = %s order by created_at desc limit 30", (user["id"],)).fetchall()
    unread = conn.execute("select count(*)::int as n from notifications where user_id = %s and read_at is null",
                          (user["id"],)).fetchone()["n"]
    return {"items": items, "unread": unread}


@router.post("/api/notifications/read", status_code=204)
def read_notifications(user: User, conn: DB):
    conn.execute("update notifications set read_at = now() where user_id = %s and read_at is null", (user["id"],))
    return Response(status_code=204)
