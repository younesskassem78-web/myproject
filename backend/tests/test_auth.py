def test_login_ok(client):
    r = client.post("/api/login", json={"email": " Demo@MyTerra.app ", "password": "demo1234"})
    assert r.status_code == 200
    assert r.json()["name"] and len(r.json()["token"]) >= 32


def test_login_wrong_password(client):
    r = client.post("/api/login", json={"email": "demo@myterra.app", "password": "nope"})
    assert r.status_code == 401
    assert r.json()["detail"] == "Invalid email or password"


def test_login_unknown_email(client):
    assert client.post("/api/login", json={"email": "x@y.z", "password": "demo1234"}).status_code == 401


def test_protected_route_without_token(client):
    r = client.get("/api/me")
    assert r.status_code == 401 and r.json()["detail"] == "Not authenticated"


def test_protected_route_with_garbage_token(client):
    assert client.get("/api/me", headers={"Authorization": "Bearer abc"}).status_code == 401
