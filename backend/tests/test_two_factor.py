"""Two-step sign-in, end to end through the API."""
import time

from app import totp


def _turn_on(client, h):
    secret = client.post("/api/account/2fa/setup", headers=h).json()["secret"]
    r = client.post("/api/account/2fa/enable", headers=h, json={"code": totp.code_at(secret, int(time.time() // 30))})
    assert r.status_code == 200
    return secret, r.json()["recovery_codes"]


def _password_step(client, email="admin@myterra.app", password="admin1234"):
    r = client.post("/api/login", json={"email": email, "password": password})
    assert r.status_code == 200
    return r.json()


def test_turning_it_on_needs_a_real_code(client, admin):
    client.post("/api/account/2fa/setup", headers=admin)
    assert client.post("/api/account/2fa/enable", headers=admin, json={"code": "000000"}).status_code == 400
    assert client.get("/api/account/2fa", headers=admin).json()["enabled"] is False


def test_sign_in_then_needs_the_code(client, admin):
    secret, _ = _turn_on(client, admin)
    first = _password_step(client)
    assert first["two_factor_required"] is True and "token" not in first  # no session from the password alone
    # the previous step's code was used to switch it on, so wait for a new one by using the next step
    code = totp.code_at(secret, int(time.time() // 30) + 1)
    r = client.post("/api/login/2fa", json={"challenge": first["challenge"], "code": code})
    assert r.status_code == 200 and r.json()["role"] == "admin"
    assert client.get("/api/me", headers={"Authorization": f"Bearer {r.json()['token']}"}).status_code == 200


def test_a_code_cannot_be_used_twice(client, admin):
    secret, _ = _turn_on(client, admin)
    code = totp.code_at(secret, int(time.time() // 30) + 1)
    c1 = _password_step(client)["challenge"]
    assert client.post("/api/login/2fa", json={"challenge": c1, "code": code}).status_code == 200
    c2 = _password_step(client)["challenge"]
    assert client.post("/api/login/2fa", json={"challenge": c2, "code": code}).status_code == 400


def test_recovery_codes_work_once(client, admin):
    _, recovery = _turn_on(client, admin)
    c1 = _password_step(client)["challenge"]
    assert client.post("/api/login/2fa", json={"challenge": c1, "code": recovery[0].upper()}).status_code == 200
    c2 = _password_step(client)["challenge"]
    assert client.post("/api/login/2fa", json={"challenge": c2, "code": recovery[0]}).status_code == 400
    assert client.get("/api/account/2fa", headers=admin).json()["recovery_left"] == 7


def test_five_wrong_codes_end_the_attempt(client, admin):
    _turn_on(client, admin)
    c = _password_step(client)["challenge"]
    for _ in range(5):
        assert client.post("/api/login/2fa", json={"challenge": c, "code": "000000"}).status_code == 400
    assert client.post("/api/login/2fa", json={"challenge": c, "code": "000000"}).status_code == 429


def test_turning_it_off_needs_password_and_code(client, admin):
    secret, recovery = _turn_on(client, admin)
    assert client.post("/api/account/2fa/disable", headers=admin, json={"password": "wrong", "code": recovery[0]}).status_code == 400
    assert client.post("/api/account/2fa/disable", headers=admin, json={"password": "admin1234", "code": recovery[1]}).status_code == 200
    assert "token" in _password_step(client)  # password alone again


def test_owner_can_reset_it_for_someone_who_lost_their_phone(client, admin, auth_headers):
    demo = auth_headers(client)
    _turn_on(client, demo)
    demo_id = client.get("/api/me", headers=demo).json()["id"]
    assert client.post(f"/api/admin/users/{demo_id}/2fa/reset", headers=demo).status_code == 403  # owners only
    assert client.post(f"/api/admin/users/{demo_id}/2fa/reset", headers=admin).status_code == 200
    assert client.get("/api/me", headers=demo).status_code == 401  # signed out everywhere
    assert "token" in _password_step(client, "demo@myterra.app", "demo1234")


def test_expired_or_unknown_challenge(client):
    r = client.post("/api/login/2fa", json={"challenge": "00000000-0000-0000-0000-000000000000", "code": "123456"})
    assert r.status_code == 400 and "expired" in r.json()["detail"]
