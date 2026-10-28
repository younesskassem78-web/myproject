import re

from app import db, notify
from app.routers.customer import check_usage_alerts


def test_notifications_read_all(client, auth_headers, admin):
    h = auth_headers(client)
    client.post("/api/admin/outages", headers=admin, json={"city": "Beirut", "title": "t", "message": "m"})
    assert client.get("/api/notifications", headers=h).json()["unread"] == 1
    client.post("/api/notifications/read", headers=h)
    assert client.get("/api/notifications", headers=h).json()["unread"] == 0


def test_usage_alerts_fire_once_per_level(client):
    with db.connect() as c:
        u = c.execute("select id from users where email = 'demo@myterra.app'").fetchone()
        check_usage_alerts(c, u["id"], used=41, limit=50, month="2026-10")
        check_usage_alerts(c, u["id"], used=42, limit=50, month="2026-10")
        check_usage_alerts(c, u["id"], used=51, limit=50, month="2026-10")
        titles = [r["title"] for r in c.execute("select title from notifications where user_id = %s "
                                                "order by created_at", (u["id"],)).fetchall()]
    assert len(titles) == 2 and "80%" in titles[0] and "all" in titles[1]


def test_change_plan(client, auth_headers):
    h = auth_headers(client)
    plans = {p["name"]: p["id"] for p in client.get("/api/plans").json()}
    r = client.post("/api/plan", headers=h, json={"plan_id": plans["Fiber Unlimited"]})
    assert r.status_code == 200
    assert client.get("/api/me", headers=h).json()["plan"]["name"] == "Fiber Unlimited"
    assert client.post("/api/plan", headers=h, json={"plan_id": plans["Fiber Unlimited"]}).status_code == 400


def test_me_has_install_and_city(client, auth_headers):
    me = client.get("/api/me", headers=auth_headers(client)).json()
    assert me["city"] == "Beirut" and me["install_status"] == "installed"


def test_admin_moves_installation_forward(client, admin, auth_headers):
    users = client.get("/api/admin/users", headers=admin).json()
    demo = next(u for u in users if u["email"] == "demo@myterra.app")
    client.patch(f"/api/admin/users/{demo['id']}", headers=admin, json={"install_status": "technician_assigned"})
    note = client.get("/api/notifications", headers=auth_headers(client)).json()["items"][0]
    assert note["kind"] == "installation"


# ---------- security ----------

def test_logout_ends_session(client, auth_headers):
    h = auth_headers(client)
    assert client.post("/api/logout", headers=h).status_code == 204
    assert client.get("/api/me", headers=h).status_code == 401


def test_expired_session(client, auth_headers):
    h = auth_headers(client)
    with db.connect() as c:
        c.execute("update tokens set expires_at = now() - interval '1 minute'")
    assert client.get("/api/me", headers=h).status_code == 401


def test_too_many_wrong_passwords_locks_sign_in(client):
    for _ in range(5):
        client.post("/api/login", json={"email": "demo@myterra.app", "password": "wrong"})
    r = client.post("/api/login", json={"email": "demo@myterra.app", "password": "demo1234"})
    assert r.status_code == 429 and "15 minutes" in r.json()["detail"]


def test_forgot_and_reset_password(client, auth_headers):
    old = auth_headers(client)
    assert client.post("/api/password/forgot", json={"email": "demo@myterra.app"}).status_code == 200
    code = re.search(r"\b(\d{6})\b", notify.OUTBOX[-1]["body"]).group(1)
    r = client.post("/api/password/reset", json={"email": "demo@myterra.app", "code": code, "password": "brandnew123"})
    assert r.status_code == 200
    assert client.get("/api/me", headers=old).status_code == 401  # other sessions signed out
    assert client.post("/api/login", json={"email": "demo@myterra.app", "password": "brandnew123"}).status_code == 200


def test_forgot_password_does_not_reveal_accounts(client):
    before = len(notify.OUTBOX)
    assert client.post("/api/password/forgot", json={"email": "nobody@x.com"}).status_code == 200
    assert len(notify.OUTBOX) == before


def test_reset_with_wrong_code(client):
    client.post("/api/password/forgot", json={"email": "demo@myterra.app"})
    r = client.post("/api/password/reset", json={"email": "demo@myterra.app", "code": "000000", "password": "brandnew123"})
    assert r.status_code == 400


def test_change_password(client, auth_headers):
    h = auth_headers(client)
    assert client.post("/api/account/password", headers=h,
                       json={"current": "nope", "password": "brandnew123"}).status_code == 400
    assert client.post("/api/account/password", headers=h,
                       json={"current": "demo1234", "password": "brandnew123"}).status_code == 200


# ---------- admin overview ----------

def test_admin_overview(client, admin):
    o = client.get("/api/admin/overview", headers=admin).json()
    k = o["kpis"]
    assert k["active_customers"] == 2 and k["mrr"] == 50.0 and k["unpaid_total"] == 50.0
    assert k["active_outages"] == 1 and k["pending_applications"] == 0
    assert len(o["revenue"]) == 6 and o["revenue"][-2]["amount"] == 50.0
