"""Signed-in customer: account, data use, top-ups, plan changes, password, notifications."""
from datetime import date, timedelta
from uuid import UUID

from fastapi import APIRouter, HTTPException, Response
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
            "card_last4", "install_status", "install_date", "install_reschedules")
    return {**{k: user[k] for k in keys}, "plan": plan, "outages": outages}


def check_usage_alerts(conn, user_id: UUID, used: float, limit: float, month: str) -> None:
    """Warn at 80% and 100% of the monthly data, once per level per month."""
    reached = [level for level in (80, 100) if used >= limit * level / 100]
    new = [r["level"] for r in (conn.execute(
        "insert into usage_alerts (user_id, month, level) values (%s, %s, %s) on conflict do nothing returning level",
        (user_id, month, level)).fetchone() for level in reached) if r]
    if 100 in new:
        events.notify_user(conn, user_id, "usage", "You've used all your data this month",
                           f"You've used {used:.1f} GB of {limit:g} GB. Buy extra data or upgrade your plan to avoid slowdowns.",
                           "/dashboard")
    elif 80 in new:
        events.notify_user(conn, user_id, "usage", "You've used 80% of your data",
                           f"You've used {used:.1f} GB of {limit:g} GB this month.", "/dashboard")


def _extra_gb(conn, user_id: UUID, month: str) -> int:
    return conn.execute("select coalesce(sum(gb), 0)::int as gb from data_addons where user_id = %s and month = %s",
                        (user_id, month)).fetchone()["gb"]


@router.get("/api/usage")
def usage(user: User, conn: DB):
    plan = conn.execute("select data_gb from plans where id = %s", (user["plan_id"],)).fetchone()
    if not plan:
        raise HTTPException(404, "No plan on this account")
    today = date.today()
    month = f"{today:%Y-%m}"
    days = daily_usage(user["email"], today)
    used = round(sum(d["gb"] for d in days), 2)
    extra = _extra_gb(conn, user["id"], month)
    limit = plan["data_gb"] + extra
    check_usage_alerts(conn, user["id"], used, limit, month)
    return {"month": month, "limit_gb": limit, "plan_gb": plan["data_gb"], "extra_gb": extra, "used_gb": used, "days": days}


# Extra data for the rest of the month, like IDM's extra-GB packs: GB -> price in USD.
DATA_PACKS = {10: 3.0, 25: 6.0, 50: 10.0}


@router.get("/api/data-packs")
def data_packs(_: User):
    return [{"gb": gb, "price": price} for gb, price in DATA_PACKS.items()]


class DataPack(BaseModel):
    gb: int
    card: Card


@router.post("/api/data-packs", status_code=201)
def buy_data_pack(body: DataPack, user: User, conn: DB):
    price = DATA_PACKS.get(body.gb)
    if price is None:
        raise HTTPException(422, "Choose one of the data packs")
    if not user["plan_id"]:
        raise HTTPException(409, "Choose a plan first")
    charge_card(body.card)
    month = f"{date.today():%Y-%m}"
    with conn.transaction():
        pay = conn.execute("insert into payments (user_id, kind, method, amount, card_brand, card_last4) "
                           "values (%s, 'data', 'card', %s, %s, %s) returning id",
                           (user["id"], price, body.card.brand(), body.card.number[-4:])).fetchone()
        conn.execute("insert into data_addons (user_id, month, gb, price, payment_id) values (%s, %s, %s, %s, %s)",
                     (user["id"], month, body.gb, price, pay["id"]))
        events.notify_user(conn, user["id"], "payment", f"{body.gb} GB extra data added",
                           f"We charged ${price:.2f} to your {body.card.brand()} ending in {body.card.number[-4:]}. "
                           "The extra data lasts until the end of this month.", "/dashboard")
    return {"extra_gb": _extra_gb(conn, user["id"], month)}


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
def change_password(body: PasswordChange, user: User, conn: DB):
    row = conn.execute("select password_hash from users where id = %s", (user["id"],)).fetchone()
    if not db.verify_password(body.current, row["password_hash"]):
        raise HTTPException(400, "Your current password is wrong")
    with conn.transaction():
        conn.execute("update users set password_hash = %s where id = %s", (db.hash_password(body.password), user["id"]))
        conn.execute("delete from tokens where user_id = %s and id <> %s", (user["id"], user["session_id"]))  # sign out elsewhere
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


MAX_RESCHEDULES = 3  # like Virgin Media: customers can move a visit up to 3 times, then they call us


class Reschedule(BaseModel):
    install_date: date


@router.post("/api/installation/reschedule")
def reschedule_installation(body: Reschedule, user: User, conn: DB):
    """Move the technician visit; allowed while it is more than 24 hours away."""
    today = date.today()
    with conn.transaction():
        u = conn.execute("select install_status, install_date, install_reschedules from users where id = %s for update",
                         (user["id"],)).fetchone()
        if not u["install_date"] or u["install_status"] == "installed":
            raise HTTPException(409, "There's no installation visit to move")
        if (u["install_date"] - today).days < 2:  # visits run 9:00-17:00, so tomorrow is already < 24 h away
            raise HTTPException(409, "Your visit is less than 24 hours away. Open a support ticket to change it.")
        if u["install_reschedules"] >= MAX_RESCHEDULES:
            raise HTTPException(409, "You've already moved this visit 3 times. Open a support ticket to change it.")
        if not timedelta(days=1) <= body.install_date - today <= timedelta(days=60):
            raise HTTPException(422, "Pick a date between tomorrow and 60 days from now")
        if body.install_date == u["install_date"]:
            raise HTTPException(422, "That's already your visit date")
        row = conn.execute("update users set install_date = %s, install_reschedules = install_reschedules + 1 "
                           "where id = %s returning install_date, install_reschedules", (body.install_date, user["id"])).fetchone()
        events.notify_user(conn, user["id"], "installation", "Installation visit moved",
                           f"Your technician visit is now on {body.install_date:%A %d %B}, between 9:00 and 17:00.", "/dashboard")
    return {**row, "changes_left": MAX_RESCHEDULES - row["install_reschedules"]}


EMAIL_TOPICS = ("billing", "outage", "ticket", "installation")


class EmailPrefs(BaseModel):
    billing: bool = True
    outage: bool = True
    ticket: bool = True
    installation: bool = True


@router.get("/api/account/email-preferences")
def email_preferences(user: User, conn: DB):
    off = conn.execute("select email_opt_out from users where id = %s", (user["id"],)).fetchone()["email_opt_out"]
    return {t: t not in off for t in EMAIL_TOPICS}


@router.put("/api/account/email-preferences")
def set_email_preferences(body: EmailPrefs, user: User, conn: DB):
    off = [t for t in EMAIL_TOPICS if not getattr(body, t)]
    conn.execute("update users set email_opt_out = %s where id = %s", (off, user["id"]))
    return {t: t not in off for t in EMAIL_TOPICS}


def _device(user_agent: str | None) -> str:
    """'Chrome on Windows' from a browser's user-agent text."""
    ua = user_agent or ""
    browser = next((name for key, name in (("Edg/", "Edge"), ("OPR/", "Opera"), ("Firefox/", "Firefox"),
                                           ("Chrome/", "Chrome"), ("Safari/", "Safari")) if key in ua), "Unknown browser")
    system = next((name for key, name in (("Android", "Android"), ("iPhone", "iPhone"), ("iPad", "iPad"),
                                          ("Windows", "Windows"), ("Mac OS", "Mac"), ("Linux", "Linux")) if key in ua), "")
    return f"{browser} on {system}" if system else browser


@router.get("/api/account/sessions")
def sessions(user: User, conn: DB):
    rows = conn.execute("select id, user_agent, ip, created_at, last_used_at from tokens "
                        "where user_id = %s and expires_at > now() order by last_used_at desc", (user["id"],)).fetchall()
    return [{"id": r["id"], "device": _device(r["user_agent"]), "ip": r["ip"], "created_at": r["created_at"],
             "last_used_at": r["last_used_at"], "current": r["id"] == user["session_id"]} for r in rows]


@router.delete("/api/account/sessions/{session_id}", status_code=204)
def end_session(session_id: UUID, user: User, conn: DB):
    if not conn.execute("delete from tokens where id = %s and user_id = %s returning id", (session_id, user["id"])).fetchone():
        raise HTTPException(404, "Session not found")
    return Response(status_code=204)


@router.post("/api/account/sessions/sign-out-others")
def end_other_sessions(user: User, conn: DB):
    n = conn.execute("delete from tokens where user_id = %s and id <> %s", (user["id"], user["session_id"])).rowcount
    return {"signed_out": n}
