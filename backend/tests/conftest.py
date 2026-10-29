import os

import pytest

os.environ.setdefault("PASSWORD_ITERATIONS", "1000")  # real default is 600,000; tests only need it to work

from app import db

os.environ["DATABASE_URL"] = os.environ["TEST_DATABASE_URL"]  # never touch the real database in tests

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    from app import notify
    for key in ("GMAIL_USER", "GMAIL_APP_PASSWORD", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"):
        monkeypatch.delenv(key, raising=False)  # tests never send real email or SMS
    notify.OUTBOX.clear()
    db.init(reset=True)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def auth_headers():
    def make(client, email="demo@myterra.app", password="demo1234"):
        token = client.post("/api/login", json={"email": email, "password": password}).json()["token"]
        return {"Authorization": f"Bearer {token}"}
    return make


@pytest.fixture
def admin(client, auth_headers):
    return auth_headers(client, "admin@myterra.app", "admin1234")


@pytest.fixture
def plan_id(client):
    return next(p["id"] for p in client.get("/api/plans").json() if p["name"] == "Fiber 50 GB")
