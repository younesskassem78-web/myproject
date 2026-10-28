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
    assert client.get("/api/health").json() == {"status": "ok"}


def test_public_plans(client):
    names = {p["name"] for p in client.get("/api/plans").json()}
    assert names == {"Fiber 50 GB", "Fiber 100 GB"}
