import os

import pytest

os.environ.setdefault("PASSWORD_ITERATIONS", "1000")
os.environ["SCHEDULER_ENABLED"] = "false"  # tests run jobs by hand  # real default is 600,000; tests only need it to work

from app import db

os.environ["DATABASE_URL"] = os.environ["TEST_DATABASE_URL"]  # never touch the real database in tests

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.outbox import enqueue as REAL_ENQUEUE  # noqa: E402,F401  (queue tests use the real one)


def send_now(conn, to, subject, body):
    """Tests deliver queued emails on the spot, so they can check them straight after the request."""
    from app import deps
    deps.send_email_quietly(to, subject, body)


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    from app import notify, outbox
    monkeypatch.setattr(outbox, "enqueue", send_now)
    for key in ("SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"):
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
