"""Regression tests for defects found in the October 2026 QA audit (docs/qa/AUDIT.md)."""
from app import db


def _user(client, admin, email):
    return next(u for u in client.get("/api/admin/users", headers=admin).json() if u["email"] == email)


# D1: tickets.speed_test_id must reference a real speed test
def test_ticket_speed_test_is_a_foreign_key(client, auth_headers):
    h = auth_headers(client)
    st = client.post("/api/speedtests", headers=h, json={"ping_ms": 5, "download_mbps": 9, "upload_mbps": 2}).json()
    t = client.post("/api/tickets", headers=h, json={"subject": "s", "message": "m", "category": "connection",
                                                      "speed_test_id": st["id"]}).json()
    with db.connect() as c:
        c.execute("delete from speed_tests where id = %s", (st["id"],))
        assert c.execute("select speed_test_id from tickets where id = %s", (t["id"],)).fetchone()["speed_test_id"] is None


# D2: lookup columns are indexed
def test_lookup_columns_are_indexed():
    with db.connect() as c:
        indexed = {r["c"] for r in c.execute(
            "select t.relname || '.' || a.attname as c from pg_index i join pg_class t on t.oid = i.indrelid "
            "join pg_attribute a on a.attrelid = t.oid and a.attnum = i.indkey[0]").fetchall()}
    for col in ("tickets.user_id", "payments.user_id", "payments.invoice_id", "tokens.user_id",
                "ticket_messages.ticket_id", "speed_tests.user_id", "users.plan_id", "applications.email",
                "audit_log.created_at"):
        assert col in indexed, f"{col} has no index"


# D3: old sign-in failures and codes are cleaned up
def test_old_failures_and_codes_are_pruned(client):
    with db.connect() as c:
        c.execute("insert into login_failures (email, created_at) values ('old@x.com', now() - interval '2 days')")
        c.execute("insert into verifications (channel, target, code_hash, expires_at, created_at) "
                  "values ('email', 'old@x.com', 'x', now() - interval '2 days', now() - interval '2 days')")
    client.post("/api/login", json={"email": "demo@myterra.app", "password": "wrong"})
    client.post("/api/verify/send", json={"channel": "email", "target": "new@x.com"})
    with db.connect() as c:
        assert c.execute("select count(*)::int as n from login_failures where email = 'old@x.com'").fetchone()["n"] == 0
        assert c.execute("select count(*)::int as n from verifications where target = 'old@x.com'").fetchone()["n"] == 0


# D5: a customer must always have a plan
def test_cannot_turn_a_planless_admin_into_a_customer(client, admin):
    client.post("/api/admin/users", headers=admin, json={"name": "Ops", "email": "ops@x.com",
                                                        "password": "secret123", "role": "admin"})
    ops = _user(client, admin, "ops@x.com")
    r = client.patch(f"/api/admin/users/{ops['id']}", headers=admin, json={"role": "customer"})
    assert r.status_code == 422 and "plan" in r.json()["detail"]
    plan = client.get("/api/plans").json()[0]["id"]
    r = client.patch(f"/api/admin/users/{ops['id']}", headers=admin, json={"role": "customer", "plan_id": plan})
    assert r.status_code == 200 and r.json()["role"] == "customer"


# D7: many failures from one address lock that address, whatever the email
def test_too_many_failures_from_one_address(client):
    for i in range(30):
        client.post("/api/login", json={"email": f"user{i}@x.com", "password": "wrong"})
    r = client.post("/api/login", json={"email": "demo@myterra.app", "password": "demo1234"})
    assert r.status_code == 429


# D9: admin lists are bounded and pageable
def test_admin_lists_take_limit_and_offset(client, admin):
    all_users = client.get("/api/admin/users", headers=admin).json()
    page = client.get("/api/admin/users?limit=1&offset=1", headers=admin)
    assert page.status_code == 200 and page.json() == all_users[1:2]
    assert page.headers["x-total-count"] == str(len(all_users))
    assert client.get("/api/admin/users?limit=5000", headers=admin).status_code == 422
