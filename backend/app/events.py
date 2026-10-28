"""Things that happen to a customer (notifications) and things admins do (audit log)."""
from app import deps


def notify_user(conn, user_id, kind: str, title: str, body: str, link: str | None = None,
                email_to: str | None = None) -> None:
    """In-app notification, plus an email when `email_to` is given (email failure never blocks the action)."""
    conn.execute("insert into notifications (user_id, kind, title, body, link) values (%s, %s, %s, %s, %s)",
                 (user_id, kind, title, body, link))
    if email_to:
        deps.send_email_quietly(email_to, title, f"{body}\n\n{deps.APP_URL}{link or '/dashboard'}\n\nMyTerra")


def audit(conn, admin: dict, action: str, target: str) -> None:
    conn.execute("insert into audit_log (admin_email, action, target) values (%s, %s, %s)",
                 (admin["email"], action, target))
