"""Invoices, payments and autopay for customers; the monthly billing run for staff."""
from datetime import date, timedelta
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, model_validator

from app import events
from app.deps import DB, Admin, Card, Limit, Offset, User, charge_card, paged

router = APIRouter()

# Overdue is worked out from the due date, so it never goes stale.
INV_COLS = ("i.id, i.number, i.period, i.plan_name, i.amount::float8 as amount, "
            "case when i.status = 'unpaid' and i.due_date < current_date then 'overdue' else i.status end as status, "
            "i.issued_at, i.due_date, i.paid_at")
PAY_COLS = ("p.id, p.invoice_id, p.kind, p.method, p.amount::float8 as amount, p.card_brand, p.card_last4, "
            "p.created_at")
DUE_DAYS = 15


def invoice_number(period: date, user_id: UUID) -> str:
    return f"INV-{period:%Y%m}-{str(user_id)[:8].upper()}"


@router.get("/api/invoices")
def invoices(user: User, conn: DB):
    return conn.execute(f"select {INV_COLS} from invoices i where i.user_id = %s order by i.period desc",
                        (user["id"],)).fetchall()


@router.get("/api/invoices/{invoice_id}")
def invoice(invoice_id: UUID, user: User, conn: DB):
    inv = conn.execute(f"select {INV_COLS} from invoices i where i.id = %s and i.user_id = %s",
                       (invoice_id, user["id"])).fetchone()
    if not inv:
        raise HTTPException(404, "Invoice not found")
    inv["customer"] = {k: user[k] for k in ("name", "email", "phone", "address")}
    inv["payments"] = conn.execute(f"select {PAY_COLS} from payments p where p.invoice_id = %s order by p.created_at",
                                   (invoice_id,)).fetchall()
    return inv


@router.get("/api/billing")
def summary(user: User, conn: DB):
    due = conn.execute("select coalesce(sum(amount), 0)::float8 as total from invoices "
                       "where user_id = %s and status = 'unpaid'", (user["id"],)).fetchone()["total"]
    nxt = conn.execute(f"select {INV_COLS} from invoices i where i.user_id = %s "
                       "order by (i.status <> 'unpaid'), i.period desc limit 1", (user["id"],)).fetchone()
    return {"amount_due": due, "next_invoice": nxt, "balance": user["balance"], "autopay": user["autopay"],
            "card_brand": user["card_brand"], "card_last4": user["card_last4"]}


@router.get("/api/payments")
def payments(user: User, conn: DB):
    return conn.execute(f"select {PAY_COLS} from payments p where p.user_id = %s order by p.created_at desc limit 50",
                        (user["id"],)).fetchall()


class PayInvoice(BaseModel):
    method: Literal["card", "balance"]
    card: Card | None = None

    @model_validator(mode="after")
    def card_needed(self):
        if self.method == "card" and not self.card:
            raise ValueError("Enter your card details")
        return self


@router.post("/api/invoices/{invoice_id}/pay")
def pay(invoice_id: UUID, body: PayInvoice, user: User, conn: DB):
    with conn.transaction():
        inv = conn.execute("select id, number, amount, status from invoices where id = %s and user_id = %s for update",
                           (invoice_id, user["id"])).fetchone()
        if not inv:
            raise HTTPException(404, "Invoice not found")
        if inv["status"] != "unpaid":
            raise HTTPException(409, "This invoice is already paid")
        brand = last4 = None
        if body.method == "card":
            charge_card(body.card)
            brand, last4 = body.card.brand(), body.card.number[-4:]
        elif not conn.execute("update users set balance = balance - %s where id = %s and balance >= %s returning id",
                              (inv["amount"], user["id"], inv["amount"])).fetchone():
            raise HTTPException(402, "Not enough balance. Top up or pay by card.")
        conn.execute("update invoices set status = 'paid', paid_at = now() where id = %s", (invoice_id,))
        conn.execute("insert into payments (user_id, invoice_id, kind, method, amount, card_brand, card_last4) "
                     "values (%s, %s, 'invoice', %s, %s, %s, %s)",
                     (user["id"], invoice_id, body.method, inv["amount"], brand, last4))
        events.notify_user(conn, user["id"], "payment", "Payment received",
                           f"Thanks! We received ${inv['amount']:.2f} for {inv['number']}.", "/billing")
    return conn.execute(f"select {INV_COLS} from invoices i where i.id = %s", (invoice_id,)).fetchone()


class Autopay(BaseModel):
    enabled: bool
    card: Card | None = None


@router.post("/api/billing/autopay")
def autopay(body: Autopay, user: User, conn: DB):
    if body.enabled and not body.card and not user["card_last4"]:
        raise HTTPException(422, "Add a card to turn on autopay")
    if body.card:
        charge_card(body.card)  # check the card works before saving it
    return conn.execute(
        "update users set autopay = %s, card_brand = coalesce(%s, card_brand), card_last4 = coalesce(%s, card_last4) "
        "where id = %s returning autopay, card_brand, card_last4",
        (body.enabled, body.card.brand() if body.card else None, body.card.number[-4:] if body.card else None,
         user["id"])).fetchone()


# ---------- staff ----------

def issue_invoice(conn, user_id: UUID, period: date, plan_name: str, amount: float, paid: bool = False):
    return conn.execute(
        "insert into invoices (user_id, number, period, plan_name, amount, status, due_date, paid_at) "
        "values (%s, %s, %s, %s, %s, %s, %s, case when %s then now() end) "
        "on conflict (user_id, period) do nothing returning id, number",
        (user_id, invoice_number(period, user_id), period, plan_name, amount, "paid" if paid else "unpaid",
         date.today() + timedelta(days=DUE_DAYS), paid)).fetchone()


@router.post("/api/admin/billing/run")
def run_billing(admin: Admin, conn: DB):
    """Issue this month's invoice to every active customer who doesn't have one yet. Safe to run twice."""
    period = date.today().replace(day=1)
    issued = autopaid = 0
    with conn.transaction():
        customers = conn.execute(
            "select u.id, u.email, u.autopay, u.card_brand, u.card_last4, p.name, p.price::float8 as price "
            "from users u join plans p on p.id = u.plan_id where u.role = 'customer' and u.active "
            "and not exists (select 1 from invoices i where i.user_id = u.id and i.period = %s)", (period,)).fetchall()
        for c in customers:
            auto = bool(c["autopay"] and c["card_last4"])
            inv = issue_invoice(conn, c["id"], period, c["name"], c["price"], paid=auto)
            if not inv:
                continue
            issued += 1
            if auto:
                autopaid += 1
                conn.execute("insert into payments (user_id, invoice_id, kind, method, amount, card_brand, card_last4) "
                             "values (%s, %s, 'invoice', 'autopay', %s, %s, %s)",
                             (c["id"], inv["id"], c["price"], c["card_brand"], c["card_last4"]))
                events.notify_user(conn, c["id"], "payment", "Autopay: payment received",
                                   f"We charged ${c['price']:.2f} to your {c['card_brand']} ending in {c['card_last4']} "
                                   f"for {inv['number']}.", "/billing", email_to=c["email"])
            else:
                events.notify_user(conn, c["id"], "invoice", "Your bill is ready",
                                   f"{inv['number']}: ${c['price']:.2f}, due in {DUE_DAYS} days.", "/billing",
                                   email_to=c["email"])
        events.audit(conn, admin, "ran billing", f"{period:%B %Y}: {issued} invoices, {autopaid} autopaid")
    return {"period": period, "issued": issued, "autopaid": autopaid}


@router.get("/api/admin/invoices")
def all_invoices(_: Admin, conn: DB, response: Response, limit: Limit = 500, offset: Offset = 0):
    return paged(conn, response, f"select {INV_COLS}, u.email as user_email, u.name as user_name from invoices i "
                 "join users u on u.id = i.user_id order by i.period desc, i.issued_at desc, i.id", (), limit, offset)
