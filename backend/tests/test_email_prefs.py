"""Customers choose which topics are also emailed; in-app notifications always arrive."""
from app import notify


def test_all_topics_on_by_default(client, auth_headers):
    prefs = client.get("/api/account/email-preferences", headers=auth_headers(client)).json()
    assert prefs == {"billing": True, "outage": True, "ticket": True, "installation": True}


def test_switching_off_outage_emails_keeps_the_in_app_alert(client, auth_headers, admin):
    h = auth_headers(client)
    r = client.put("/api/account/email-preferences", headers=h, json={"outage": False})
    assert r.json()["outage"] is False and r.json()["billing"] is True
    before = len(notify.OUTBOX)
    client.post("/api/admin/outages", headers=admin, json={"city": "Beirut", "title": "Down", "message": "Fixing."})
    assert not [m for m in notify.OUTBOX[before:] if m["to"] == "demo@myterra.app"]  # no email
    assert client.get("/api/notifications", headers=h).json()["items"][0]["kind"] == "outage"  # still told in the app


def test_other_topics_still_email(client, auth_headers, admin):
    h = auth_headers(client)
    client.put("/api/account/email-preferences", headers=h, json={"outage": False})
    t = client.get("/api/admin/tickets", headers=admin).json()[0]
    before = len(notify.OUTBOX)
    client.post(f"/api/admin/tickets/{t['id']}/messages", headers=admin, json={"body": "We fixed it."})
    assert [m for m in notify.OUTBOX[before:] if m["to"] == "demo@myterra.app"]


def test_preferences_are_per_customer(client, auth_headers):
    client.put("/api/account/email-preferences", headers=auth_headers(client), json={"billing": False})
    sara = client.get("/api/account/email-preferences", headers=auth_headers(client, "sara@myterra.app", "sara1234")).json()
    assert sara["billing"] is True
