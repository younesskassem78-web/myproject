"""Signed-in devices: tokens are stored only as fingerprints; customers can see and end their sessions."""
from app import db


def _login(client, ua):
    r = client.post("/api/login", json={"email": "demo@myterra.app", "password": "demo1234"}, headers={"User-Agent": ua})
    return {"Authorization": f"Bearer {r.json()['token']}"}


PHONE = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36"
LAPTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0"


def test_tokens_are_stored_as_fingerprints_only(client):
    raw = _login(client, LAPTOP)["Authorization"].removeprefix("Bearer ")
    with db.connect() as c:
        stored = [r["token"] for r in c.execute("select token from tokens").fetchall()]
    assert raw not in stored and all(len(t) == 64 for t in stored)


def test_lists_devices_and_marks_this_one(client):
    _login(client, PHONE)
    laptop = _login(client, LAPTOP)
    sessions = client.get("/api/account/sessions", headers=laptop).json()
    assert {s["device"] for s in sessions} == {"Chrome on Android", "Edge on Windows"}
    assert [s["device"] for s in sessions if s["current"]] == ["Edge on Windows"]
    assert all("token" not in s for s in sessions)


def test_end_one_session(client):
    phone = _login(client, PHONE)
    laptop = _login(client, LAPTOP)
    phone_id = next(s["id"] for s in client.get("/api/account/sessions", headers=laptop).json() if not s["current"])
    assert client.delete(f"/api/account/sessions/{phone_id}", headers=laptop).status_code == 204
    assert client.get("/api/me", headers=phone).status_code == 401
    assert client.get("/api/me", headers=laptop).status_code == 200


def test_sign_out_everywhere_else(client):
    phone = _login(client, PHONE)
    laptop = _login(client, LAPTOP)
    assert client.post("/api/account/sessions/sign-out-others", headers=laptop).json()["signed_out"] == 1
    assert client.get("/api/me", headers=phone).status_code == 401
    assert client.get("/api/me", headers=laptop).status_code == 200


def test_cannot_end_someone_elses_session(client, auth_headers):
    demo = _login(client, PHONE)
    demo_id = client.get("/api/account/sessions", headers=demo).json()[0]["id"]
    sara = auth_headers(client, "sara@myterra.app", "sara1234")
    assert client.delete(f"/api/account/sessions/{demo_id}", headers=sara).status_code == 404
    assert client.get("/api/me", headers=demo).status_code == 200


def test_old_plain_tokens_keep_working_after_the_upgrade(client):
    with db.connect() as c:
        uid = c.execute("select id from users where email = 'demo@myterra.app'").fetchone()["id"]
        c.execute("insert into tokens (token, user_id) values ('legacy-plain-token', %s)", (uid,))
    db.init()  # runs the upgrade, which turns stored tokens into fingerprints
    assert client.get("/api/me", headers={"Authorization": "Bearer legacy-plain-token"}).status_code == 200
