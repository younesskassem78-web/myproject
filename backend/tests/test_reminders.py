"""Billing run reminds customers once about bills due within 3 days."""
from datetime import date, timedelta

from app import db, notify


def _due_in(days, email="demo@myterra.app"):
    with db.connect() as c:
        c.execute("update invoices set due_date = %s, reminded_at = null where status = 'unpaid' "
                  "and user_id = (select id from users where email = %s)", (date.today() + timedelta(days=days), email))


def test_bill_due_soon_gets_one_reminder(client, admin, auth_headers):
    _due_in(2)
    r = client.post("/api/admin/billing/run", headers=admin).json()
    assert r["reminded"] >= 1
    assert client.get("/api/notifications", headers=auth_headers(client)).json()["items"][0]["title"] == "Your bill is due soon"
    assert any(m["to"] == "demo@myterra.app" and m["subject"] == "Your bill is due soon" for m in notify.OUTBOX)
    assert client.post("/api/admin/billing/run", headers=admin).json()["reminded"] == 0  # only once


def test_no_reminder_for_bills_due_later(client, admin):
    _due_in(10)
    before = len(notify.OUTBOX)
    client.post("/api/admin/billing/run", headers=admin)
    assert not [m for m in notify.OUTBOX[before:] if m["subject"] == "Your bill is due soon" and m["to"] == "demo@myterra.app"]


def test_autopay_customers_are_not_reminded(client, admin):
    _due_in(1)
    with db.connect() as c:
        c.execute("update users set autopay = true, card_brand = 'Visa', card_last4 = '4242' where email = 'demo@myterra.app'")
    client.post("/api/admin/billing/run", headers=admin)
    with db.connect() as c:
        assert c.execute("select reminded_at from invoices i join users u on u.id = i.user_id "
                         "where u.email = 'demo@myterra.app' and i.status = 'unpaid'").fetchone()["reminded_at"] is None
