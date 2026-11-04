"""Emails nobody waits for go out in the background: a slow email service doesn't slow the request."""
import time
from concurrent.futures import ThreadPoolExecutor

from app import deps, notify


def test_outage_request_does_not_wait_for_email(client, admin, monkeypatch):
    sent = []

    def slow_send(to, subject, body):
        time.sleep(1.0)  # Brevo takes ~5 s per email
        sent.append(to)

    monkeypatch.setattr(notify, "send_email", slow_send)
    monkeypatch.setattr(deps, "MAILER", ThreadPoolExecutor(max_workers=4))
    started = time.perf_counter()
    r = client.post("/api/admin/outages", headers=admin, json={"city": "Beirut", "title": "Down", "message": "Fixing it."})
    assert r.status_code == 201
    assert time.perf_counter() - started < 0.8  # would be >= 1 s if the email were sent during the request
    deps.MAILER.shutdown(wait=True)
    assert "demo@myterra.app" in sent  # and the email still went out


def test_failed_background_email_is_logged_not_raised(client, admin, monkeypatch, caplog):
    def broken(*a):
        raise OSError("SMTP down")

    monkeypatch.setattr(notify, "send_email", broken)
    r = client.post("/api/admin/outages", headers=admin, json={"city": "Beirut", "title": "Down", "message": "Fixing it."})
    assert r.status_code == 201
    assert "Email to demo@myterra.app failed" in caplog.text
