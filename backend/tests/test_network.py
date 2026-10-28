def test_public_status_page(client):
    s = client.get("/api/status").json()
    assert [o["city"] for o in s["active"]] == ["Tripoli"]
    assert s["recent"][0]["status"] == "resolved"


def test_customer_sees_outage_in_their_city(client, auth_headers):
    sara = client.get("/api/me", headers=auth_headers(client, "sara@myterra.app", "sara1234")).json()
    assert sara["outages"][0]["title"] == "Slow speeds in parts of Tripoli"
    assert client.get("/api/me", headers=auth_headers(client)).json()["outages"] == []


def test_admin_outage_lifecycle_notifies_city(client, admin, auth_headers):
    demo = auth_headers(client)
    r = client.post("/api/admin/outages", headers=admin, json={
        "city": "Beirut", "title": "No internet in Hamra", "message": "A power cut hit our cabinet."})
    assert r.status_code == 201
    note = client.get("/api/notifications", headers=demo).json()["items"][0]
    assert note["kind"] == "outage" and "Hamra" in note["title"]
    sara = auth_headers(client, "sara@myterra.app", "sara1234")
    assert all(n["kind"] != "outage" for n in client.get("/api/notifications", headers=sara).json()["items"])

    oid = r.json()["id"]
    r = client.patch(f"/api/admin/outages/{oid}", headers=admin, json={"status": "resolved", "message": "Power is back."})
    assert r.status_code == 200 and r.json()["resolved_at"]
    assert "resolved" in client.get("/api/notifications", headers=demo).json()["items"][0]["title"].lower()
    assert client.get("/api/me", headers=demo).json()["outages"] == []
    assert client.get("/api/admin/audit", headers=admin).json()[0]["action"] == "updated outage"


def test_customers_cannot_post_outages(client, auth_headers):
    r = client.post("/api/admin/outages", headers=auth_headers(client), json={"city": "B", "title": "t", "message": "m"})
    assert r.status_code == 403
