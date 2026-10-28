import pytest


def apply(client, plan_id, email="new@x.com", password="secret123"):
    return client.post("/api/apply", json={"name": "New Person", "email": email, "password": password, "plan_id": plan_id})


def test_apply_then_login_waits_for_approval(client, plan_id):
    r = apply(client, plan_id)
    assert r.status_code == 201 and r.json()["status"] == "pending"
    r = client.post("/api/login", json={"email": "new@x.com", "password": "secret123"})
    assert r.status_code == 403 and r.json()["detail"] == "Your application is waiting for approval"


def test_pending_message_needs_right_password(client, plan_id):
    apply(client, plan_id)
    assert client.post("/api/login", json={"email": "new@x.com", "password": "wrong"}).status_code == 401


def test_approve_creates_account_with_uuid(client, plan_id, admin):
    app_id = apply(client, plan_id).json()["id"]
    r = client.post(f"/api/admin/applications/{app_id}/approve", headers=admin)
    assert r.status_code == 200 and len(r.json()["user_id"]) == 36
    r = client.post("/api/login", json={"email": "New@X.com", "password": "secret123"})
    assert r.status_code == 200 and r.json()["role"] == "customer"
    me = client.get("/api/me", headers={"Authorization": f"Bearer {r.json()['token']}"}).json()
    assert me["plan"]["name"] == "Fiber 50 GB" and me["balance"] == 0


def test_approve_twice_fails(client, plan_id, admin):
    app_id = apply(client, plan_id).json()["id"]
    client.post(f"/api/admin/applications/{app_id}/approve", headers=admin)
    assert client.post(f"/api/admin/applications/{app_id}/approve", headers=admin).status_code == 404


def test_reject(client, plan_id, admin):
    app_id = apply(client, plan_id).json()["id"]
    assert client.post(f"/api/admin/applications/{app_id}/reject", headers=admin).status_code == 200
    r = client.post("/api/login", json={"email": "new@x.com", "password": "secret123"})
    assert r.status_code == 403 and r.json()["detail"] == "Your application was not approved"


def test_cannot_apply_with_existing_account_email(client, plan_id):
    assert apply(client, plan_id, email="demo@myterra.app").status_code == 409


def test_cannot_apply_twice_while_pending(client, plan_id):
    apply(client, plan_id)
    assert apply(client, plan_id).status_code == 409


@pytest.mark.parametrize("email,password", [("not-an-email", "secret123"), ("a@b.co", "short")])
def test_apply_validation(client, plan_id, email, password):
    assert apply(client, plan_id, email, password).status_code == 422


def test_apply_unknown_plan(client):
    assert apply(client, "00000000-0000-0000-0000-000000000000").status_code == 422
