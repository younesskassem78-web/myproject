def test_customers_cannot_use_admin(client, auth_headers):
    assert client.get("/api/admin/users", headers=auth_headers(client)).status_code == 403


def test_list_users_hides_password_hash(client, admin):
    users = client.get("/api/admin/users", headers=admin).json()
    assert {u["email"] for u in users} >= {"demo@myterra.app", "sara@myterra.app", "admin@myterra.app"}
    assert all("password_hash" not in u for u in users)


def test_create_user(client, admin, plan_id):
    r = client.post("/api/admin/users", headers=admin, json={
        "name": "Ali", "email": "ali@x.com", "password": "secret123", "plan_id": plan_id, "balance": 3})
    assert r.status_code == 201
    assert client.post("/api/login", json={"email": "ali@x.com", "password": "secret123"}).status_code == 200


def test_create_customer_needs_plan(client, admin):
    r = client.post("/api/admin/users", headers=admin, json={"name": "A", "email": "a@x.com", "password": "secret123"})
    assert r.status_code == 422


def test_create_duplicate_email(client, admin, plan_id):
    r = client.post("/api/admin/users", headers=admin, json={
        "name": "D", "email": "demo@myterra.app", "password": "secret123", "plan_id": plan_id})
    assert r.status_code == 409


def _user(client, admin, email):
    return next(u for u in client.get("/api/admin/users", headers=admin).json() if u["email"] == email)


def test_change_plan_and_balance(client, admin, auth_headers):
    sara = _user(client, admin, "sara@myterra.app")
    p50 = next(p["id"] for p in client.get("/api/admin/plans", headers=admin).json() if p["name"] == "Fiber 50 GB")
    r = client.patch(f"/api/admin/users/{sara['id']}", headers=admin, json={"plan_id": p50, "balance": 99})
    assert r.status_code == 200
    me = client.get("/api/me", headers=auth_headers(client, "sara@myterra.app", "sara1234")).json()
    assert me["plan"]["name"] == "Fiber 50 GB" and me["balance"] == 99


def test_deactivate_logs_out_and_blocks_login(client, admin, auth_headers):
    h = auth_headers(client)
    demo = _user(client, admin, "demo@myterra.app")
    client.patch(f"/api/admin/users/{demo['id']}", headers=admin, json={"active": False})
    assert client.get("/api/me", headers=h).status_code == 401
    r = client.post("/api/login", json={"email": "demo@myterra.app", "password": "demo1234"})
    assert r.status_code == 403
    client.patch(f"/api/admin/users/{demo['id']}", headers=admin, json={"active": True})
    assert client.post("/api/login", json={"email": "demo@myterra.app", "password": "demo1234"}).status_code == 200


def test_reset_password(client, admin):
    demo = _user(client, admin, "demo@myterra.app")
    client.patch(f"/api/admin/users/{demo['id']}", headers=admin, json={"password": "newpass123"})
    assert client.post("/api/login", json={"email": "demo@myterra.app", "password": "newpass123"}).status_code == 200


def test_delete_user_removes_tickets(client, admin, auth_headers):
    demo = _user(client, admin, "demo@myterra.app")
    assert client.delete(f"/api/admin/users/{demo['id']}", headers=admin).status_code == 204
    assert client.post("/api/login", json={"email": "demo@myterra.app", "password": "demo1234"}).status_code == 401
    assert client.get("/api/admin/tickets", headers=admin).json() == []


def test_admin_cannot_delete_or_deactivate_self(client, admin):
    me = _user(client, admin, "admin@myterra.app")
    assert client.delete(f"/api/admin/users/{me['id']}", headers=admin).status_code == 400
    assert client.patch(f"/api/admin/users/{me['id']}", headers=admin, json={"active": False}).status_code == 400
    assert client.patch(f"/api/admin/users/{me['id']}", headers=admin, json={"role": "customer"}).status_code == 400


def test_bad_uuid_is_422(client, admin):
    assert client.delete("/api/admin/users/nope", headers=admin).status_code == 422


def test_plan_crud(client, admin):
    r = client.post("/api/admin/plans", headers=admin, json={"name": "Fiber 200 GB", "data_gb": 200, "price": 45})
    assert r.status_code == 201
    pid = r.json()["id"]
    assert client.patch(f"/api/admin/plans/{pid}", headers=admin, json={"price": 40}).json()["price"] == 40
    client.patch(f"/api/admin/plans/{pid}", headers=admin, json={"active": False})
    assert "Fiber 200 GB" not in {p["name"] for p in client.get("/api/plans").json()}
    assert client.delete(f"/api/admin/plans/{pid}", headers=admin).status_code == 204


def test_cannot_delete_plan_in_use(client, admin):
    p50 = next(p for p in client.get("/api/admin/plans", headers=admin).json() if p["name"] == "Fiber 50 GB")
    assert p50["users"] == 1
    assert client.delete(f"/api/admin/plans/{p50['id']}", headers=admin).status_code == 409


def test_admin_updates_ticket_status(client, admin, auth_headers):
    t = client.get("/api/admin/tickets", headers=admin).json()[0]
    assert t["user_email"] == "demo@myterra.app"
    r = client.patch(f"/api/admin/tickets/{t['id']}", headers=admin, json={"status": "in_progress"})
    assert r.status_code == 200
    assert client.get("/api/tickets", headers=auth_headers(client)).json()[0]["status"] == "in_progress"
    assert client.patch(f"/api/admin/tickets/{t['id']}", headers=admin, json={"status": "bogus"}).status_code == 422
