"""Emails that nobody waits for (bills, receipts, outages, ticket replies) go through this queue.

`enqueue` writes the email in the caller's transaction: if the action rolls back, so does its email, and a
restart can't lose it. The background sender (app/scheduler.py) delivers due emails, retrying failures with
growing pauses. Several server processes can deliver at once: each claims different rows (SKIP LOCKED).
"""
from app import notify
from app.deps import log

MAX_ATTEMPTS = 5


def enqueue(conn, to: str, subject: str, body: str) -> None:
    conn.execute("insert into email_outbox (to_addr, subject, body) values (%s, %s, %s)", (to, subject, body))


def deliver_due(conn, limit: int = 20) -> dict:
    """Send up to `limit` emails that are due; returns how many were sent and how many failed this round."""
    # A row stuck in 'sending' means a process died mid-send: try it again after 10 minutes.
    conn.execute("update email_outbox set status = 'pending' where status = 'sending' and locked_at < now() - interval '10 minutes'")
    batch = conn.execute(
        "update email_outbox set status = 'sending', locked_at = now(), attempts = attempts + 1 where id in ("
        " select id from email_outbox where status = 'pending' and next_attempt_at <= now()"
        " order by created_at limit %s for update skip locked) returning id, to_addr, subject, body, attempts",
        (limit,)).fetchall()
    sent = failed = 0
    for m in batch:
        try:
            notify.send_email(m["to_addr"], m["subject"], m["body"])
        except Exception as e:  # noqa: BLE001 — any delivery problem means "try again later"
            failed += 1
            give_up = m["attempts"] >= MAX_ATTEMPTS
            log.warning("Email to %s failed (attempt %s): %s", m["to_addr"], m["attempts"], e)
            conn.execute("update email_outbox set status = %s, last_error = %s, "
                         "next_attempt_at = now() + make_interval(mins => %s) where id = %s",
                         ("failed" if give_up else "pending", str(e)[:500], 2 ** m["attempts"], m["id"]))
        else:
            sent += 1
            conn.execute("update email_outbox set status = 'sent', sent_at = now(), last_error = null where id = %s", (m["id"],))
    return {"sent": sent, "failed": failed}


def stats(conn) -> dict:
    return conn.execute(
        "select count(*) filter (where status in ('pending', 'sending'))::int as waiting, "
        "count(*) filter (where status = 'failed')::int as failed, "
        "count(*) filter (where status = 'sent' and sent_at > now() - interval '1 day')::int as sent_today "
        "from email_outbox").fetchone()
