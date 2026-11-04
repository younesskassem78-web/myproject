"""Customers move their own installation visit (more than 24 h ahead, at most 3 times)."""
from datetime import date, timedelta

from app import db


def _set_visit(email, days_ahead, status="scheduled", moves=0):
    with db.connect() as c:
        c.execute("update users set install_status = %s, install_date = %s, install_reschedules = %s where email = %s",
                  (status, date.today() + timedelta(days=days_ahead), moves, email))


def _move(client, h, days_ahead):
    return client.post("/api/installation/reschedule", headers=h,
                       json={"install_date": str(date.today() + timedelta(days=days_ahead))})


def test_customer_moves_their_visit(client, auth_headers):
    _set_visit("demo@myterra.app", 5)
    h = auth_headers(client)
    r = _move(client, h, 9)
    assert r.status_code == 200 and r.json()["changes_left"] == 2
    me = client.get("/api/me", headers=h).json()
    assert me["install_date"] == str(date.today() + timedelta(days=9)) and me["install_reschedules"] == 1
    assert client.get("/api/notifications", headers=h).json()["items"][0]["title"] == "Installation visit moved"


def test_not_within_24_hours(client, auth_headers):
    _set_visit("demo@myterra.app", 1)
    r = _move(client, auth_headers(client), 9)
    assert r.status_code == 409 and "24 hours" in r.json()["detail"]


def test_at_most_three_times(client, auth_headers):
    _set_visit("demo@myterra.app", 5, moves=3)
    r = _move(client, auth_headers(client), 9)
    assert r.status_code == 409 and "3 times" in r.json()["detail"]


def test_new_date_must_be_in_the_window(client, auth_headers):
    _set_visit("demo@myterra.app", 5)
    h = auth_headers(client)
    assert _move(client, h, 0).status_code == 422
    assert _move(client, h, 61).status_code == 422
    assert _move(client, h, 5).status_code == 422  # same day


def test_nothing_to_move_once_installed(client, auth_headers):
    _set_visit("demo@myterra.app", 5, status="installed")
    assert _move(client, auth_headers(client), 9).status_code == 409


def test_only_your_own_visit(client, auth_headers):
    _set_visit("demo@myterra.app", 5)
    _set_visit("sara@myterra.app", 5)
    _move(client, auth_headers(client, "sara@myterra.app", "sara1234"), 9)
    with db.connect() as c:
        demo = c.execute("select install_date from users where email = 'demo@myterra.app'").fetchone()
    assert demo["install_date"] == date.today() + timedelta(days=5)
