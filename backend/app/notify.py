"""Email (Gmail SMTP) and SMS (Twilio). Without credentials in .env, messages are only logged (demo mode)."""
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


def send_email(to: str, subject: str, body: str) -> None:
    user, password = os.environ.get("GMAIL_USER"), os.environ.get("GMAIL_APP_PASSWORD")
    if not (user and password):
        return _demo("email", to, subject, body)
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = f"MyTerra <{user}>", to, subject
    msg.set_content(body)
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=15) as smtp:
        smtp.login(user, password.replace(" ", ""))
        smtp.send_message(msg)


def send_sms(to: str, body: str) -> None:
    sid, token, sender = (os.environ.get(k) for k in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"))
    if not (sid and token and sender):
        return _demo("sms", to, "", body)
    r = httpx.post(f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
                   auth=(sid, token), data={"From": sender, "To": to, "Body": body}, timeout=15)
    if r.status_code >= 400:
        raise RuntimeError(r.json().get("message", "Twilio error"))
