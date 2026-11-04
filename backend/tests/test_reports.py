"""Revenue report, admin search/paging and CSV exports."""
import csv
import io
from datetime import date, timedelta

from app import db

CARD = {"holder": "Demo User", "number": "4242 4242 4242 4242", "expiry": "12/30", "cvc": "123"}


def test_revenue_report_matches_the_payments_table(client, admin):
    r = client.get("/api/admin/reports/revenue", headers=admin, params={"start": str(date.today() - timedelta(days=365)), "end": str(date.today())})
    assert r.status_code == 200
    rep = r.json()
    with db.connect() as c:
        total = c.execute("select coalesce(sum(amount), 0)::float8 as t from payments").fetchone()["t"]
    assert rep["received"] == round(total, 2) and sum(m["total"] for m in rep["by_month"]) == round(total, 2)


def test_revenue_report_counts_a_new_payment_in_range(client, admin, auth_headers):
    today = str(date.today())
    before = client.get("/api/admin/reports/revenue", headers=admin, params={"start": today, "end": today}).json()
    client.post("/api/data-packs", headers=auth_headers(client), json={"gb": 10, "card": CARD})
    after = client.get("/api/admin/reports/revenue", headers=admin, params={"start": today, "end": today}).json()
    assert round(after["received"] - before["received"], 2) == 3.0
    assert any(k["kind"] == "data" and k["total"] == 3.0 for k in after["by_kind"])


def test_revenue_report_rejects_backwards_dates(client, admin):
    r = client.get("/api/admin/reports/revenue", headers=admin, params={"start": "2026-02-01", "end": "2026-01-01"})
    assert r.status_code == 422


def test_reports_are_admin_only(client, auth_headers):
    h = auth_headers(client)
    assert client.get("/api/admin/reports/revenue", headers=h).status_code == 403
    assert client.get("/api/admin/export/customers.csv", headers=h).status_code == 403


def test_customer_search_and_paging_happen_on_the_server(client, admin):
    r = client.get("/api/admin/users", headers=admin, params={"q": "tripoli"})
    assert [u["email"] for u in r.json()] == ["sara@myterra.app"] and r.headers["X-Total-Count"] == "1"
    page = client.get("/api/admin/users", headers=admin, params={"limit": 1, "offset": 1})
    assert len(page.json()) == 1 and int(page.headers["X-Total-Count"]) >= 3


def test_bill_search_and_status_filter(client, admin):
    unpaid = client.get("/api/admin/invoices", headers=admin, params={"status": "unpaid"}).json()
    assert unpaid and all(b["status"] == "unpaid" for b in unpaid)
    paid = client.get("/api/admin/invoices", headers=admin, params={"status": "paid", "q": "sara"}).json()
    assert paid and all(b["status"] == "paid" and b["user_email"] == "sara@myterra.app" for b in paid)
    assert client.get("/api/admin/invoices", headers=admin, params={"status": "nonsense"}).status_code == 422


def test_customer_export_is_a_csv_file(client, admin):
    r = client.get("/api/admin/export/customers.csv", headers=admin)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers["content-disposition"]
    rows = list(csv.DictReader(io.StringIO(r.text.lstrip("﻿"))))
    assert {"name", "email", "plan", "balance"} <= set(rows[0]) and {r["email"] for r in rows} >= {"demo@myterra.app"}
    assert all(r["email"] != "admin@myterra.app" for r in rows)  # staff aren't customers


def test_export_neutralises_spreadsheet_formulas(client, admin):
    with db.connect() as c:
        c.execute("update users set name = '=HYPERLINK(\"http://evil\")' where email = 'demo@myterra.app'")
    text = client.get("/api/admin/export/customers.csv", headers=admin).text
    assert "'=HYPERLINK" in text and ",=HYPERLINK" not in text


def test_payment_export_respects_the_date_range(client, admin):
    future = str(date.today() + timedelta(days=400))
    r = client.get("/api/admin/export/payments.csv", headers=admin, params={"start": future, "end": future})
    lines = r.text.lstrip("﻿").strip().splitlines()
    assert lines == ["created_at,customer,email,kind,method,amount,card_brand,card_last4"]
