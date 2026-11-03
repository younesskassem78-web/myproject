"""Email (any SMTP service: Brevo, Gmail, ...) and SMS (Twilio). Without settings, messages are only logged."""
import logging
import os
import smtplib
from email.message import EmailMessage

import httpx

log = logging.getLogger("uvicorn.error")
OUTBOX: list[dict] = []  # demo mode keeps messages here so tests and the console can see them


def _demo(channel: str, to: str, subject: str, body: str) -> None:
    OUTBOX.append({"channel": channel, "to": to, "subject": subject, "body": body})
    log.warning("DEMO %s to %s | %s | %s", channel.upper(), to, subject, body.replace("\n", " "))


SMTP_KEYS = ("SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD")


def email_is_live() -> bool:
    return all(os.environ.get(k) for k in SMTP_KEYS)


def sms_is_live() -> bool:
    return all(os.environ.get(k) for k in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"))


def send_email(to: str, subject: str, body: str) -> None:
    if not email_is_live():
        return _demo("email", to, subject, body)
    host, user, password = (os.environ[k] for k in SMTP_KEYS)
    port = int(os.environ.get("SMTP_PORT") or 587)
    msg = EmailMessage()
    # Brevo's login isn't a mailbox, so the sender is its own setting (a sender address verified in Brevo)
    msg["From"], msg["To"], msg["Subject"] = f"MyTerra <{os.environ.get('EMAIL_FROM') or user}>", to, subject
    msg.set_content(body)
    # 465 = encrypted from the start (Gmail); 587 = upgrade with STARTTLS (Brevo and most others)
    with (smtplib.SMTP_SSL(host, port, timeout=15) if port == 465 else smtplib.SMTP(host, port, timeout=15)) as smtp:
        if port != 465:
            smtp.starttls()
        smtp.login(user, password.replace(" ", ""))  # Gmail app passwords are shown with spaces
        smtp.send_message(msg)


def send_sms(to: str, body: str) -> None:
    sid, token, sender = (os.environ.get(k) for k in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"))
    if not (sid and token and sender):
        return _demo("sms", to, "", body)
    r = httpx.post(f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
                   auth=(sid, token), data={"From": sender, "To": to, "Body": body}, timeout=15)
    if r.status_code >= 400:
        raise RuntimeError(r.json().get("message", "Twilio error"))
