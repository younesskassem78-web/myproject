import uuid
from datetime import date

from app import db
from app.deps import daily_usage


def test_seed_uses_uuids():
    with db.connect() as c:
        u = c.execute("select * from users where email = 'demo@myterra.app'").fetchone()
    assert isinstance(u["id"], uuid.UUID) and float(u["balance"]) == 5.0


def test_passwords_are_salted():
    assert db.hash_password("same") != db.hash_password("same")
    assert db.verify_password("same", db.hash_password("same"))
    assert not db.verify_password("other", db.hash_password("same"))


def test_daily_usage_is_deterministic_and_covers_month_so_far():
    a = daily_usage("demo@myterra.app", date(2026, 10, 29))
    assert a == daily_usage("demo@myterra.app", date(2026, 10, 29))
    assert [d["day"] for d in a] == list(range(1, 30))
    assert all(0.3 <= d["gb"] <= 2.5 for d in a)


def test_daily_usage_on_first_day():
    assert len(daily_usage("demo@myterra.app", date(2026, 11, 1))) == 1


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok", "database": "ok"}


def test_public_plans(client):
    names = {p["name"] for p in client.get("/api/plans").json()}
    assert names == {"Fiber 50 GB", "Fiber 100 GB", "Fiber Unlimited"}


def test_old_password_hashes_still_work_and_get_upgraded(client):
    import hashlib
    legacy = "abc$" + hashlib.pbkdf2_hmac("sha256", b"oldpass123", b"abc", 200_000).hex()
    assert db.verify_password("oldpass123", legacy) and db.needs_rehash(legacy)
    with db.connect() as c:
        c.execute("update users set password_hash = %s where email = 'demo@myterra.app'", (legacy,))
    assert client.post("/api/login", json={"email": "demo@myterra.app", "password": "oldpass123"}).status_code == 200
    with db.connect() as c:
        stored = c.execute("select password_hash from users where email = 'demo@myterra.app'").fetchone()["password_hash"]
    assert stored.startswith("pbkdf2_sha256$") and not db.needs_rehash(stored)


def test_security_headers(client):
    r = client.get("/api/plans")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["cache-control"] == "no-store"


def test_production_creates_admin_without_demo_data(monkeypatch):
    monkeypatch.setenv("DEMO_DATA", "false")
    monkeypatch.setenv("ADMIN_EMAIL", "Boss@Company.com")
    monkeypatch.setenv("ADMIN_PASSWORD", "a-long-secret")
    db.init(reset=True)
    with db.connect() as c:
        users = c.execute("select email, role from users").fetchall()
        assert users == [{"email": "boss@company.com", "role": "admin"}]
        assert c.execute("select count(*)::int as n from plans").fetchone()["n"] == 0
