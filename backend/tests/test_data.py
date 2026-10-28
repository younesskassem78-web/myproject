from datetime import date

from app import data


def test_seed_users():
    assert data.USERS["demo@myterra.app"]["plan_id"] == "fiber50"
    assert data.PLANS["fiber50"] == {"id": "fiber50", "name": "Fiber 50 GB", "data_gb": 50, "price": 20.0}
    assert data.USERS["sara@myterra.app"]["balance"] == 12.5


def test_daily_usage_is_deterministic_and_covers_month_so_far():
    a = data.daily_usage("demo@myterra.app", date(2026, 10, 29))
    assert a == data.daily_usage("demo@myterra.app", date(2026, 10, 29))
    assert [d["day"] for d in a] == list(range(1, 30))
    assert all(0.3 <= d["gb"] <= 2.5 for d in a)


def test_daily_usage_on_first_day():
    assert len(data.daily_usage("demo@myterra.app", date(2026, 11, 1))) == 1


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}
