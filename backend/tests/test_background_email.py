"""Emails nobody waits for are queued: a slow email service doesn't slow the request."""
import time

from app import db, notify, outbox
from conftest import REAL_ENQUEUE


def test_outage_request_does_not_wait_for_email(client, admin, monkeypatch):
    sent = []

    def slow_send(to, subject, body):
        time.sleep(1.0)  # Brevo takes ~5 s per email
        sent.append(to)

    monkeypatch.setattr(notify, "send_email", slow_send)
    monkeypatch.setattr(outbox, "enqueue", REAL_ENQUEUE)
    started = time.perf_counter()
    r = client.post("/api/admin/outages", headers=admin, json={"city": "Beirut", "title": "Down", "message": "Fixing it."})
    assert r.status_code == 201
    assert time.perf_counter() - started < 0.8  # would be >= 1 s if the email were sent during the request
    with db.connect() as c:
        outbox.deliver_due(c)
    assert "demo@myterra.app" in sent  # and the email still went out


def test_failed_email_is_kept_for_retry_not_raised(client, admin, monkeypatch, caplog):
    def broken(*a):
        raise OSError("SMTP down")

    monkeypatch.setattr(notify, "send_email", broken)
    monkeypatch.setattr(outbox, "enqueue", REAL_ENQUEUE)
    r = client.post("/api/admin/outages", headers=admin, json={"city": "Beirut", "title": "Down", "message": "Fixing it."})
    assert r.status_code == 201
    with db.connect() as c:
        outbox.deliver_due(c)
        row = c.execute("select status, last_error from email_outbox where to_addr = 'demo@myterra.app'").fetchone()
    assert row["status"] == "pending" and "SMTP down" in row["last_error"]
    assert "Email to demo@myterra.app failed" in caplog.text
