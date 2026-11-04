"""Background jobs inside the API process: deliver queued emails, and once a day issue this month's bills
(on any day: it only bills customers who don't have one yet) and send due-soon reminders.

With several server processes, a PostgreSQL advisory lock makes exactly one of them the job runner.
Turn everything off with SCHEDULER_ENABLED=false (tests do), or only the billing job with AUTO_BILLING=false.
"""
import os
import threading
from datetime import datetime

from app import db, outbox
from app.deps import log

LOCK_KEY = 4_242_042  # any fixed number shared by every MyTerra process
EMAIL_EVERY_S = 10
BILLING_HOUR = int(os.environ.get("BILLING_HOUR", "8"))  # local server time; bills go out after this hour


def enabled() -> bool:
    return os.environ.get("SCHEDULER_ENABLED", "true").lower() != "false"


def auto_billing() -> bool:
    """Separate switch: email delivery can run while automatic billing stays off (e.g. on a copy of real data)."""
    return os.environ.get("AUTO_BILLING", "true").lower() != "false"


def run_daily_billing(conn, now: datetime) -> dict | None:
    """Run billing once per day, after BILLING_HOUR. Returns the result, or None if it wasn't due."""
    if now.hour < BILLING_HOUR:
        return None
    claimed = conn.execute(
        "insert into job_runs (name, last_run_on, last_run_at) values ('daily_billing', %s, now()) "
        "on conflict (name) do update set last_run_on = excluded.last_run_on, last_run_at = now() "
        "where job_runs.last_run_on is distinct from excluded.last_run_on returning name", (now.date(),)).fetchone()
    if not claimed:
        return None  # already ran today
    from app.routers.billing import issue_month  # late import: routers import deps, which imports this package
    result = issue_month(conn, "automatic billing")
    conn.execute("update job_runs set last_result = %s where name = 'daily_billing'",
                 (f"{result['issued']} bills, {result['autopaid']} autopaid, {result['reminded']} reminders",))
    return result


class Scheduler:
    def __init__(self):
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="myterra-scheduler", daemon=True)
        self._conn = None
        self.leader = False

    def start(self):
        self._thread.start()

    def stop(self):
        self._stop.set()
        self._thread.join(timeout=5)

    def tick(self):
        if self._conn is None or self._conn.closed:
            self._conn = db.connect()
            self.leader = False
        if not self.leader:  # session lock: held for as long as this connection lives
            self.leader = self._conn.execute("select pg_try_advisory_lock(%s) as ok", (LOCK_KEY,)).fetchone()["ok"]
        if not self.leader:
            return
        while (done := outbox.deliver_due(self._conn))["sent"] + done["failed"]:
            pass  # keep going while there's a backlog
        result = run_daily_billing(self._conn, datetime.now()) if auto_billing() else None
        if result:
            log.info("Automatic billing: %s", result)

    def _run(self):
        while not self._stop.is_set():
            try:
                self.tick()
            except Exception:  # noqa: BLE001 — a bad tick must not kill the scheduler; try again next time
                log.exception("Scheduler tick failed")
                if self._conn is not None:
                    self._conn.close()
                self._conn = None
            self._stop.wait(EMAIL_EVERY_S)
        if self._conn is not None:
            self._conn.close()
