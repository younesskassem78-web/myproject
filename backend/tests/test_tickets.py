import pytest


def test_seeded_ticket_visible(client, auth_headers):
    t = client.get("/api/tickets", headers=auth_headers(client)).json()
    assert t[0]["status"] == "resolved"


def test_create_ticket(client, auth_headers):
    h = auth_headers(client)
    r = client.post("/api/tickets", json={"subject": "  My internet is slow ", "message": "Since Monday"}, headers=h)
    assert r.status_code == 201
    assert r.json()["status"] == "open" and r.json()["subject"] == "My internet is slow"
    assert client.get("/api/tickets", headers=h).json()[0]["id"] == r.json()["id"]


@pytest.mark.parametrize("body", [
    {"subject": "", "message": "x"},
    {"subject": "   ", "message": "x"},
    {"subject": "x", "message": "  "},
    {"subject": "x" * 101, "message": "x"},
    {"subject": "x", "message": "x" * 1001},
])
def test_create_ticket_rejects_bad_input(client, auth_headers, body):
    assert client.post("/api/tickets", json=body, headers=auth_headers(client)).status_code == 422


def test_users_only_see_own_tickets(client, auth_headers):
    client.post("/api/tickets", json={"subject": "a", "message": "b"}, headers=auth_headers(client))
    assert client.get("/api/tickets", headers=auth_headers(client, "sara@myterra.app", "sara1234")).json() == []
