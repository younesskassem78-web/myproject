from datetime import date

import pytest


def test_me(client, auth_headers):
    me = client.get("/api/me", headers=auth_headers(client)).json()
    assert me["plan"]["name"] == "Fiber 50 GB" and me["plan"]["price"] == 20.0 and me["balance"] == 5.0
    assert "password_hash" not in me


def test_me_other_user(client, auth_headers):
    me = client.get("/api/me", headers=auth_headers(client, "sara@myterra.app", "sara1234")).json()
    assert me["plan"]["data_gb"] == 100


def test_usage(client, auth_headers):
    u = client.get("/api/usage", headers=auth_headers(client)).json()
    assert u["limit_gb"] == 50
    assert u["used_gb"] == round(sum(d["gb"] for d in u["days"]), 2)
    assert len(u["days"]) == date.today().day


def test_topup_adds_to_balance(client, auth_headers):
    h = auth_headers(client)
    assert client.post("/api/topup", json={"amount": 10}, headers=h).json() == {"balance": 15.0}
    assert client.get("/api/me", headers=h).json()["balance"] == 15.0


@pytest.mark.parametrize("amount", [0, -5, 500.01, "abc", None])
def test_topup_rejects_bad_amounts(client, auth_headers, amount):
    h = auth_headers(client)
    assert client.post("/api/topup", json={"amount": amount}, headers=h).status_code == 422
    assert client.get("/api/me", headers=h).json()["balance"] == 5.0


def test_topup_max_is_allowed(client, auth_headers):
    assert client.post("/api/topup", json={"amount": 500}, headers=auth_headers(client)).status_code == 200
