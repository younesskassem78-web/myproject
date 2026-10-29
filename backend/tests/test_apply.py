import re
from datetime import date, timedelta

import pytest

from app import notify


def code_for(target):
    msg = next(m for m in reversed(notify.OUTBOX) if m["to"] == target)
    return re.search(r"\b(\d{6})\b", msg["body"]).group(1)


def verify(client, channel, target):
    assert client.post("/api/verify/send", json={"channel": channel, "target": target}).status_code == 200
    r = client.post("/api/verify/check", json={"channel": channel, "target": target, "code": code_for(target)})
    assert r.status_code == 200
    return r.json()["verification_id"]


def form(client, plan_id, email="new@x.com", phone="+96170123456", **over):
    body = {
        "name": "New Person", "email": email, "phone": phone, "password": "secret123",
        "birth_date": "1995-04-12", "id_number": "LB1234567", "city": "Beirut",
        "street": "Hamra St, Bldg 12", "apartment": "3rd floor", "install_date": str(date.today() + timedelta(days=3)),
        "plan_id": plan_id, "accept_terms": True,
        "card": {"holder": "New Person", "number": "4242 4242 4242 4242", "expiry": "12/30", "cvc": "123"},
    }
    if "email_verification_id" not in over:
        body["email_verification_id"] = verify(client, "email", email)
    if "phone_verification_id" not in over:
        body["phone_verification_id"] = verify(client, "sms", phone)
    for k, v in over.items():
        body[k] = v
    return body


def apply(client, plan_id, **kw):
    return client.post("/api/apply", json=form(client, plan_id, **kw))


# ---------- verification codes ----------

def test_email_code_is_sent_and_checked(client):
    client.post("/api/verify/send", json={"channel": "email", "target": "A@B.co"})
    assert notify.OUTBOX[-1]["to"] == "a@b.co"
    r = client.post("/api/verify/check", json={"channel": "email", "target": "a@b.co", "code": "000000"})
    assert r.status_code == 400 and r.json()["detail"] == "Wrong code"


def test_sms_code_normalises_phone(client):
    client.post("/api/verify/send", json={"channel": "sms", "target": "+961 70-123 456"})
    assert notify.OUTBOX[-1]["to"] == "+96170123456" and notify.OUTBOX[-1]["channel"] == "sms"


def test_resend_is_rate_limited(client):
    client.post("/api/verify/send", json={"channel": "email", "target": "a@b.co"})
    assert client.post("/api/verify/send", json={"channel": "email", "target": "a@b.co"}).status_code == 429


def test_too_many_wrong_codes_locks_the_code(client):
    client.post("/api/verify/send", json={"channel": "email", "target": "a@b.co"})
    good = code_for("a@b.co")
    for _ in range(5):
        client.post("/api/verify/check", json={"channel": "email", "target": "a@b.co", "code": "000000"})
    r = client.post("/api/verify/check", json={"channel": "email", "target": "a@b.co", "code": good})
    assert r.status_code == 400 and "new code" in r.json()["detail"]


@pytest.mark.parametrize("channel,target", [("email", "nope"), ("sms", "12345"), ("fax", "a@b.co")])
def test_bad_targets(client, channel, target):
    assert client.post("/api/verify/send", json={"channel": channel, "target": target}).status_code == 422


# ---------- applying ----------

def test_apply_then_login_waits_for_approval(client, plan_id):
    r = apply(client, plan_id)
    assert r.status_code == 201 and r.json()["status"] == "pending"
    assert notify.OUTBOX[-1]["to"] == "new@x.com" and "received" in notify.OUTBOX[-1]["subject"].lower()
    r = client.post("/api/login", json={"email": "new@x.com", "password": "secret123"})
    assert r.status_code == 403 and r.json()["detail"] == "Your application is waiting for approval"


def test_card_is_never_stored_in_full(client, plan_id, admin):
    apply(client, plan_id)
    a = client.get("/api/admin/applications", headers=admin).json()[0]
    assert a["card_brand"] == "Visa" and a["card_last4"] == "4242" and a["amount_paid"] == 20.0
    assert "4242424242424242" not in str(a) and "cvc" not in a


def test_declined_card(client, plan_id):
    r = apply(client, plan_id, card={"holder": "N P", "number": "4000000000000002", "expiry": "12/30", "cvc": "123"})
    assert r.status_code == 402 and "declined" in r.json()["detail"]


@pytest.mark.parametrize("card", [
    {"holder": "N P", "number": "4242424242424241", "expiry": "12/30", "cvc": "123"},  # fails Luhn
    {"holder": "N P", "number": "4242424242424242", "expiry": "01/20", "cvc": "123"},  # expired
    {"holder": "N P", "number": "4242424242424242", "expiry": "13/30", "cvc": "123"},  # bad month
    {"holder": "N P", "number": "4242424242424242", "expiry": "12/30", "cvc": "12"},   # short cvc
])
def test_invalid_cards(client, plan_id, card):
    assert apply(client, plan_id, card=card).status_code == 422


def test_needs_verified_email(client, plan_id):
    assert apply(client, plan_id, email_verification_id="00000000-0000-0000-0000-000000000000").status_code == 400


def test_verification_cannot_be_reused_for_other_email(client, plan_id):
    vid = verify(client, "email", "other@x.com")
    assert apply(client, plan_id, email_verification_id=vid).status_code == 400


def test_verification_is_single_use(client, plan_id, admin):
    body = form(client, plan_id)
    assert client.post("/api/apply", json=body).status_code == 201
    app_id = client.get("/api/admin/applications", headers=admin).json()[0]["id"]
    client.post(f"/api/admin/applications/{app_id}/reject", headers=admin)
    assert client.post("/api/apply", json=body).status_code == 400


def test_must_be_adult(client, plan_id):
    assert apply(client, plan_id, birth_date=str(date.today().replace(year=date.today().year - 17))).status_code == 422


@pytest.mark.parametrize("days", [0, 61])
def test_install_date_window(client, plan_id, days):
    assert apply(client, plan_id, install_date=str(date.today() + timedelta(days=days))).status_code == 422


def test_must_accept_terms(client, plan_id):
    assert apply(client, plan_id, accept_terms=False).status_code == 422


def test_approve_creates_account_and_emails_link(client, plan_id, admin):
    app_id = apply(client, plan_id).json()["id"]
    r = client.post(f"/api/admin/applications/{app_id}/approve", headers=admin)
    assert r.status_code == 200 and len(r.json()["user_id"]) == 36 and r.json()["email_sent"] is True
    mail = notify.OUTBOX[-1]
    assert mail["to"] == "new@x.com" and "approved" in mail["subject"].lower()
    assert "http://localhost:4200/login" in mail["body"] and "secret123" not in mail["body"]
    r = client.post("/api/login", json={"email": "New@X.com", "password": "secret123"})
    assert r.status_code == 200 and r.json()["role"] == "customer"
    users = client.get("/api/admin/users", headers=admin).json()
    assert next(u for u in users if u["email"] == "new@x.com")["phone"] == "+96170123456"


def test_approve_twice_fails(client, plan_id, admin):
    app_id = apply(client, plan_id).json()["id"]
    client.post(f"/api/admin/applications/{app_id}/approve", headers=admin)
    assert client.post(f"/api/admin/applications/{app_id}/approve", headers=admin).status_code == 404


def test_approval_survives_email_failure(client, plan_id, admin, monkeypatch):
    app_id = apply(client, plan_id).json()["id"]
    monkeypatch.setattr(notify, "send_email", lambda *a: (_ for _ in ()).throw(OSError("smtp down")))
    r = client.post(f"/api/admin/applications/{app_id}/approve", headers=admin)
    assert r.status_code == 200 and r.json()["email_sent"] is False


def test_reject_emails_refund(client, plan_id, admin):
    app_id = apply(client, plan_id).json()["id"]
    assert client.post(f"/api/admin/applications/{app_id}/reject", headers=admin).status_code == 200
    assert "refund" in notify.OUTBOX[-1]["body"].lower()
    r = client.post("/api/login", json={"email": "new@x.com", "password": "secret123"})
    assert r.status_code == 403 and r.json()["detail"] == "Your application was not approved"


def test_cannot_apply_with_existing_account_email(client, plan_id):
    assert apply(client, plan_id, email="demo@myterra.app").status_code == 409


def test_cannot_apply_twice_while_pending(client, plan_id):
    apply(client, plan_id)
    assert apply(client, plan_id, phone="+96170999999").status_code == 409


def test_short_password(client, plan_id):
    assert apply(client, plan_id, password="short").status_code == 422


def test_apply_unknown_plan(client):
    assert apply(client, "00000000-0000-0000-0000-000000000000").status_code == 422


# ---------- demo codes on screen ----------

def test_demo_mode_shows_the_code(client):
    r = client.post("/api/verify/send", json={"channel": "email", "target": "a@b.co"}).json()
    assert r["demo_code"] == code_for("a@b.co")


def test_no_demo_code_in_production(client, monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    assert "demo_code" not in client.post("/api/verify/send", json={"channel": "sms", "target": "+96170111222"}).json()


def test_no_demo_code_when_email_is_live(client, monkeypatch):
    monkeypatch.setenv("GMAIL_USER", "x@gmail.com")
    monkeypatch.setenv("GMAIL_APP_PASSWORD", "pw")
    monkeypatch.setattr(notify, "send_email", lambda *a: None)  # don't really send
    assert "demo_code" not in client.post("/api/verify/send", json={"channel": "email", "target": "a@b.co"}).json()


def test_password_reset_never_shows_a_code(client):
    assert client.post("/api/password/forgot", json={"email": "demo@myterra.app"}).json() == {"sent": True}
