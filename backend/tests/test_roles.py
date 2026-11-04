"""Staff roles: the owner sees everything; billing and support staff only their part, enforced by the server."""
import pytest


@pytest.fixture
def staff(client, admin, auth_headers):
    made = {}
    for role in ("billing", "support"):
        r = client.post("/api/admin/users", headers=admin, json={
            "email": f"{role}@myterra.app", "name": f"{role.title()} Staff", "password": f"{role}12345", "role": role})
        assert r.status_code == 201, r.text
        made[role] = auth_headers(client, f"{role}@myterra.app", f"{role}12345")
    return made


# (method, path, body) → which roles may use it
MATRIX = [
    ("get", "/api/admin/overview", None, {"admin", "billing", "support"}),
    ("get", "/api/admin/users", None, {"admin", "billing", "support"}),
    ("get", "/api/admin/applications", None, {"admin", "billing"}),
    ("get", "/api/admin/invoices", None, {"admin", "billing"}),
    ("get", "/api/admin/reports/revenue", None, {"admin", "billing"}),
    ("get", "/api/admin/export/payments.csv", None, {"admin", "billing"}),
    ("get", "/api/admin/automation", None, {"admin", "billing"}),
    ("get", "/api/admin/tickets", None, {"admin", "support"}),
    ("get", "/api/admin/outages", None, {"admin", "support"}),
    ("get", "/api/admin/audit", None, {"admin"}),
    ("post", "/api/admin/plans", {"name": "Test plan", "data_gb": 5, "price": 1}, {"admin"}),
    ("post", "/api/admin/users", {"email": "x@y.co", "name": "X", "password": "x1234567", "role": "support"}, {"admin"}),
]


@pytest.mark.parametrize("method,path,body,allowed", MATRIX, ids=[m[1] + " " + m[0] for m in MATRIX])
def test_each_role_reaches_only_its_pages(client, admin, staff, auth_headers, method, path, body, allowed):
    headers = {"admin": admin, **staff, "customer": auth_headers(client)}
    for role, h in headers.items():
        r = getattr(client, method)(path, headers=h, **({"json": body} if body else {}))
        assert (r.status_code < 400) == (role in allowed), f"{role} {method} {path} -> {r.status_code}"


def test_support_overview_has_no_money(client, staff):
    o = client.get("/api/admin/overview", headers=staff["support"]).json()
    assert "mrr" not in o["kpis"] and o["revenue"] is None and "open_tickets" in o["kpis"]


def test_billing_staff_edit_customers_but_not_roles_or_staff(client, admin, staff):
    users = client.get("/api/admin/users", headers=admin).json()
    demo = next(u for u in users if u["email"] == "demo@myterra.app")
    support = next(u for u in users if u["email"] == "support@myterra.app")
    b = staff["billing"]
    assert client.patch(f"/api/admin/users/{demo['id']}", headers=b, json={"balance": 12}).status_code == 200
    assert client.patch(f"/api/admin/users/{demo['id']}", headers=b, json={"role": "admin"}).status_code == 403
    assert client.patch(f"/api/admin/users/{demo['id']}", headers=b, json={"password": "hacked123"}).status_code == 403
    assert client.patch(f"/api/admin/users/{support['id']}", headers=b, json={"balance": 1}).status_code == 403
    assert client.delete(f"/api/admin/users/{demo['id']}", headers=b).status_code == 403


def test_support_cannot_change_customers(client, admin, staff):
    demo = next(u for u in client.get("/api/admin/users", headers=admin).json() if u["email"] == "demo@myterra.app")
    assert client.patch(f"/api/admin/users/{demo['id']}", headers=staff["support"], json={"balance": 99}).status_code == 403


def test_staff_cannot_promote_themselves(client, staff):
    me = client.get("/api/me", headers=staff["billing"]).json()
    r = client.patch(f"/api/admin/users/{me['id']}", headers=staff["billing"], json={"role": "admin"})
    assert r.status_code in (400, 403)


def test_owner_cannot_demote_themselves(client, admin):
    me = client.get("/api/me", headers=admin).json()
    assert client.patch(f"/api/admin/users/{me['id']}", headers=admin, json={"role": "support"}).status_code == 400


def test_login_reports_the_staff_role(client, staff):
    r = client.post("/api/login", json={"email": "support@myterra.app", "password": "support12345"})
    assert r.json()["role"] == "support"
