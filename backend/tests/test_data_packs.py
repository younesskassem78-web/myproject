"""Buying extra data for the rest of the month."""
from app import db

CARD = {"holder": "Demo User", "number": "4242 4242 4242 4242", "expiry": "12/30", "cvc": "123"}


def test_packs_are_listed(client, auth_headers):
    packs = client.get("/api/data-packs", headers=auth_headers(client)).json()
    assert [p["gb"] for p in packs] == [10, 25, 50] and all(p["price"] > 0 for p in packs)


def test_buying_a_pack_raises_the_limit_and_records_the_payment(client, auth_headers):
    h = auth_headers(client)
    before = client.get("/api/usage", headers=h).json()
    r = client.post("/api/data-packs", headers=h, json={"gb": 25, "card": CARD})
    assert r.status_code == 201 and r.json()["extra_gb"] == 25
    after = client.get("/api/usage", headers=h).json()
    assert after["limit_gb"] == before["limit_gb"] + 25 and after["extra_gb"] == 25 and after["plan_gb"] == before["plan_gb"]
    pay = client.get("/api/payments", headers=h).json()[0]
    assert pay["kind"] == "data" and pay["amount"] == 6.0 and pay["card_last4"] == "4242"
    assert client.get("/api/notifications", headers=h).json()["items"][0]["title"] == "25 GB extra data added"


def test_packs_add_up_within_the_month(client, auth_headers):
    h = auth_headers(client)
    client.post("/api/data-packs", headers=h, json={"gb": 10, "card": CARD})
    assert client.post("/api/data-packs", headers=h, json={"gb": 10, "card": CARD}).json()["extra_gb"] == 20


def test_last_months_packs_do_not_count(client, auth_headers):
    h = auth_headers(client)
    client.post("/api/data-packs", headers=h, json={"gb": 50, "card": CARD})
    with db.connect() as c:
        c.execute("update data_addons set month = '2000-01'")
    assert client.get("/api/usage", headers=h).json()["extra_gb"] == 0


def test_only_listed_packs_can_be_bought(client, auth_headers):
    r = client.post("/api/data-packs", headers=auth_headers(client), json={"gb": 1000, "card": CARD})
    assert r.status_code == 422


def test_declined_card_adds_nothing(client, auth_headers):
    h = auth_headers(client)
    r = client.post("/api/data-packs", headers=h, json={"gb": 10, "card": {**CARD, "number": "4000 0000 0000 0002"}})
    assert r.status_code == 402
    assert client.get("/api/usage", headers=h).json()["extra_gb"] == 0


def test_packs_need_sign_in(client):
    assert client.post("/api/data-packs", json={"gb": 10, "card": CARD}).status_code == 401
