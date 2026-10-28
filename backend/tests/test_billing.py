import pytest

from app import db

CARD = {"holder": "Demo User", "number": "4242424242424242", "expiry": "12/30", "cvc": "123"}


def invoices(client, h):
    return client.get("/api/invoices", headers=h).json()


def test_invoice_history(client, auth_headers):
    inv = invoices(client, auth_headers(client))
    assert [i["status"] for i in inv] == ["unpaid", "paid", "paid"]
    assert inv[0]["amount"] == 20.0 and inv[0]["number"].startswith("INV-")


def test_billing_summary(client, auth_headers):
    s = client.get("/api/billing", headers=auth_headers(client)).json()
    assert s["amount_due"] == 20.0 and s["autopay"] is False and s["next_invoice"]["status"] == "unpaid"


def test_invoice_detail_and_privacy(client, auth_headers):
    inv = invoices(client, auth_headers(client))[0]
    assert client.get(f"/api/invoices/{inv['id']}", headers=auth_headers(client)).json()["customer"]["name"] == "Demo User"
    sara = auth_headers(client, "sara@myterra.app", "sara1234")
    assert client.get(f"/api/invoices/{inv['id']}", headers=sara).status_code == 404


def test_pay_invoice_by_card(client, auth_headers):
    h = auth_headers(client)
    inv = invoices(client, h)[0]
    r = client.post(f"/api/invoices/{inv['id']}/pay", headers=h, json={"method": "card", "card": CARD})
    assert r.status_code == 200 and r.json()["status"] == "paid"
    pay = client.get("/api/payments", headers=h).json()[0]
    assert pay["card_last4"] == "4242" and pay["amount"] == 20.0 and pay["kind"] == "invoice"
    assert client.get("/api/notifications", headers=h).json()["items"][0]["kind"] == "payment"
    assert client.post(f"/api/invoices/{inv['id']}/pay", headers=h, json={"method": "card", "card": CARD}).status_code == 409


def test_pay_from_balance_needs_enough(client, auth_headers):
    h = auth_headers(client)
    inv = invoices(client, h)[0]
    r = client.post(f"/api/invoices/{inv['id']}/pay", headers=h, json={"method": "balance"})
    assert r.status_code == 402 and "balance" in r.json()["detail"]
    client.post("/api/topup", headers=h, json={"amount": 15, "card": CARD})
    assert client.post(f"/api/invoices/{inv['id']}/pay", headers=h, json={"method": "balance"}).status_code == 200
    assert client.get("/api/me", headers=h).json()["balance"] == 0


def test_declined_card(client, auth_headers):
    h = auth_headers(client)
    inv = invoices(client, h)[0]
    r = client.post(f"/api/invoices/{inv['id']}/pay", headers=h,
                    json={"method": "card", "card": {**CARD, "number": "4000000000000002"}})
    assert r.status_code == 402


def test_card_payment_needs_card(client, auth_headers):
    h = auth_headers(client)
    inv = invoices(client, h)[0]
    assert client.post(f"/api/invoices/{inv['id']}/pay", headers=h, json={"method": "card"}).status_code == 422


def test_topup_records_payment(client, auth_headers):
    h = auth_headers(client)
    client.post("/api/topup", headers=h, json={"amount": 10, "card": CARD})
    assert client.get("/api/payments", headers=h).json()[0]["kind"] == "topup"


def test_overdue_is_computed(client, auth_headers):
    with db.connect() as c:
        c.execute("update invoices set due_date = current_date - 1 where status = 'unpaid'")
    assert invoices(client, auth_headers(client))[0]["status"] == "overdue"


def test_autopay_needs_a_card(client, auth_headers):
    h = auth_headers(client)
    assert client.post("/api/billing/autopay", headers=h, json={"enabled": True}).status_code == 422
    r = client.post("/api/billing/autopay", headers=h, json={"enabled": True, "card": CARD})
    assert r.status_code == 200 and r.json() == {"autopay": True, "card_brand": "Visa", "card_last4": "4242"}
    assert client.post("/api/billing/autopay", headers=h, json={"enabled": False}).json()["autopay"] is False


@pytest.fixture
def new_customer(client, admin, plan_id, auth_headers):
    client.post("/api/admin/users", headers=admin, json={
        "name": "Nada", "email": "nada@x.com", "password": "secret123", "plan_id": plan_id})
    return auth_headers(client, "nada@x.com", "secret123")


def test_billing_run_is_once_per_month(client, admin, new_customer):
    r = client.post("/api/admin/billing/run", headers=admin).json()
    assert r["issued"] == 1 and r["autopaid"] == 0
    assert client.post("/api/admin/billing/run", headers=admin).json()["issued"] == 0
    assert invoices(client, new_customer)[0]["status"] == "unpaid"
    assert client.get("/api/notifications", headers=new_customer).json()["items"][0]["kind"] == "invoice"


def test_billing_run_charges_autopay(client, admin, new_customer):
    client.post("/api/billing/autopay", headers=new_customer, json={"enabled": True, "card": CARD})
    assert client.post("/api/admin/billing/run", headers=admin).json()["autopaid"] == 1
    assert invoices(client, new_customer)[0]["status"] == "paid"
    assert client.get("/api/payments", headers=new_customer).json()[0]["method"] == "autopay"


def test_admin_invoice_list(client, admin):
    inv = client.get("/api/admin/invoices", headers=admin).json()
    assert len(inv) == 6 and {"user_email", "status", "amount"} <= set(inv[0])
