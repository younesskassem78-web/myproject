"""The email queue and the daily billing job."""
from datetime import datetime

import pytest

from app import db, notify, outbox, scheduler
from conftest import REAL_ENQUEUE


@pytest.fixture
def real_queue(monkeypatch):
    monkeypatch.setattr(outbox, "enqueue", REAL_ENQUEUE)


def _queued(status=None):
    with db.connect() as c:
        q = "select to_addr, subject, status, attempts from email_outbox" + (" where status = %s" if status else "")
        return c.execute(q, (status,) if status else ()).fetchall()


def test_emails_wait_in_the_queue_until_delivered(client, admin, real_queue):
    client.post("/api/admin/outages", headers=admin, json={"city": "Beirut", "title": "Down", "message": "Fixing."})
    waiting = _queued("pending")
    assert any(m["to_addr"] == "demo@myterra.app" for m in waiting)
    before = len(notify.OUTBOX)
    with db.connect() as c:
        assert outbox.deliver_due(c)["sent"] == len(waiting)
    assert len(notify.OUTBOX) == before + len(waiting) and not _queued("pending")


def test_rolled_back_action_sends_no_email(real_queue):
    with db.connect() as c:
        with pytest.raises(RuntimeError), c.transaction():
            outbox.enqueue(c, "a@b.co", "Hi", "Body")
            raise RuntimeError("the action failed after queueing its email")
    assert _queued() == []


def test_failures_are_retried_then_given_up(monkeypatch, real_queue):
    monkeypatch.setattr(notify, "send_email", lambda *a: (_ for _ in ()).throw(OSError("SMTP down")))
    with db.connect() as c:
        outbox.enqueue(c, "a@b.co", "Hi", "Body")
        for _ in range(outbox.MAX_ATTEMPTS):
            c.execute("update email_outbox set next_attempt_at = now()")  # skip the waiting between tries
            assert outbox.deliver_due(c)["failed"] == 1
    [m] = _queued()
    assert m["status"] == "failed" and m["attempts"] == outbox.MAX_ATTEMPTS


def test_admin_can_retry_failed_emails(client, admin, real_queue):
    with db.connect() as c:
        outbox.enqueue(c, "a@b.co", "Hi", "Body")
        c.execute("update email_outbox set status = 'failed', attempts = 5")
    assert client.get("/api/admin/automation", headers=admin).json()["emails"]["failed"] == 1
    assert client.post("/api/admin/email-queue/retry", headers=admin).json() == {"retried": 1}
    assert _queued("pending")


def test_daily_billing_runs_once_a_day_after_the_billing_hour(client, admin):
    early = datetime.now().replace(hour=max(0, scheduler.BILLING_HOUR - 1))
    late = datetime.now().replace(hour=scheduler.BILLING_HOUR)
    with db.connect() as c:
        if scheduler.BILLING_HOUR > 0:
            assert scheduler.run_daily_billing(c, early) is None
        first = scheduler.run_daily_billing(c, late)
        assert first is not None
        assert scheduler.run_daily_billing(c, late) is None  # not twice the same day
    status = client.get("/api/admin/automation", headers=admin).json()
    assert status["last_billing_at"] and "bills" in status["last_billing_result"]
    log = client.get("/api/admin/audit", headers=admin).json()
    assert log[0]["admin_email"] == "automatic billing" and log[0]["action"] == "ran billing"


def test_only_one_process_runs_the_jobs():
    a, b = scheduler.Scheduler(), scheduler.Scheduler()
    try:
        a.tick()
        b.tick()
        assert a.leader and not b.leader
    finally:
        for s in (a, b):
            if s._conn is not None:
                s._conn.close()


def test_automation_is_admin_only(client, auth_headers):
    assert client.get("/api/admin/automation", headers=auth_headers(client)).status_code == 403


def test_auto_billing_can_be_off_while_emails_still_go(monkeypatch, real_queue):
    monkeypatch.setenv("AUTO_BILLING", "false")
    with db.connect() as c:
        outbox.enqueue(c, "a@b.co", "Hi", "Body")
    s = scheduler.Scheduler()
    try:
        s.tick()
    finally:
        s._conn.close()
    assert _queued("sent") and not _queued("pending")
    with db.connect() as c:
        assert c.execute("select 1 from job_runs where name = 'daily_billing'").fetchone() is None
