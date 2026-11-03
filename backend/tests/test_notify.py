"""The real email (SMTP) and Twilio paths, with the network replaced by fakes (no message leaves the machine)."""
import pytest

from app import notify


class FakeSMTP:
    sent, calls = [], []

    def __init__(self, host, port, timeout):
        FakeSMTP.calls.append(("connect", host, port))

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def starttls(self):
        FakeSMTP.calls.append(("starttls",))

    def login(self, user, password):
        assert " " not in password  # Gmail app passwords are pasted with spaces; they must be removed
        FakeSMTP.calls.append(("login", user))

    def send_message(self, msg):
        FakeSMTP.sent.append(msg)


@pytest.fixture
def smtp(monkeypatch):
    monkeypatch.setattr(notify.smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(notify.smtplib, "SMTP_SSL", FakeSMTP)
    FakeSMTP.sent.clear()
    FakeSMTP.calls.clear()
    return FakeSMTP


def test_brevo_path(monkeypatch, smtp):
    for k, v in (("SMTP_HOST", "smtp-relay.brevo.com"), ("SMTP_PORT", "587"), ("SMTP_USER", "abc@smtp-brevo.com"),
                 ("SMTP_PASSWORD", "xsmtpsib-key"), ("EMAIL_FROM", "shop@gmail.com")):
        monkeypatch.setenv(k, v)
    notify.send_email("a@b.co", "Hello", "Body text")
    assert smtp.calls == [("connect", "smtp-relay.brevo.com", 587), ("starttls",), ("login", "abc@smtp-brevo.com")]
    msg = smtp.sent[0]
    assert msg["To"] == "a@b.co" and msg["Subject"] == "Hello" and "shop@gmail.com" in msg["From"]
    assert notify.email_is_live() and not notify.OUTBOX  # real path, not demo


def test_gmail_path(monkeypatch, smtp):
    for k, v in (("SMTP_HOST", "smtp.gmail.com"), ("SMTP_PORT", "465"), ("SMTP_USER", "shop@gmail.com"),
                 ("SMTP_PASSWORD", "abcd efgh ijkl mnop")):
        monkeypatch.setenv(k, v)
    notify.send_email("a@b.co", "Hello", "Body text")
    assert ("starttls",) not in smtp.calls and smtp.calls[0] == ("connect", "smtp.gmail.com", 465)
    assert "shop@gmail.com" in smtp.sent[0]["From"]  # sender defaults to the login


class FakeResponse:
    def __init__(self, status, body):
        self.status_code, self._body = status, body

    def json(self):
        return self._body


def _twilio_env(monkeypatch):
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "AC123")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "tok")
    monkeypatch.setenv("TWILIO_FROM", "+15550001111")


def test_twilio_path(monkeypatch):
    _twilio_env(monkeypatch)
    calls = []
    monkeypatch.setattr(notify.httpx, "post", lambda url, **kw: calls.append((url, kw)) or FakeResponse(201, {}))
    notify.send_sms("+96170123456", "Your code is 123456")
    url, kw = calls[0]
    assert url.endswith("/Accounts/AC123/Messages.json")
    assert kw["data"] == {"From": "+15550001111", "To": "+96170123456", "Body": "Your code is 123456"}
    assert kw["auth"] == ("AC123", "tok")


def test_twilio_error_is_raised(monkeypatch):
    _twilio_env(monkeypatch)
    monkeypatch.setattr(notify.httpx, "post", lambda url, **kw: FakeResponse(400, {"message": "unverified number"}))
    with pytest.raises(RuntimeError, match="unverified number"):
        notify.send_sms("+96170123456", "x")


def test_failed_sms_gives_a_clear_error_and_leaves_no_code(client, monkeypatch):
    _twilio_env(monkeypatch)
    monkeypatch.setattr(notify.httpx, "post", lambda url, **kw: FakeResponse(400, {"message": "unverified number"}))
    r = client.post("/api/verify/send", json={"channel": "sms", "target": "+96170123456"})
    assert r.status_code == 502 and "couldn't send the SMS" in r.json()["detail"]
    # no orphan code was left behind, so asking again isn't blocked by the one-minute limit
    monkeypatch.setattr(notify.httpx, "post", lambda url, **kw: FakeResponse(201, {}))
    assert client.post("/api/verify/send", json={"channel": "sms", "target": "+96170123456"}).status_code == 200
