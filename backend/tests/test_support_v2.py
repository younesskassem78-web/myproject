def first_ticket(client, h):
    return client.get("/api/tickets", headers=h).json()[0]


def test_ticket_thread_includes_staff_reply(client, auth_headers):
    h = auth_headers(client)
    t = client.get(f"/api/tickets/{first_ticket(client, h)['id']}", headers=h).json()
    assert t["category"] == "connection"
    assert t["messages"][0]["from_staff"] is True


def test_create_with_category_and_speed_test(client, auth_headers):
    h = auth_headers(client)
    st = client.post("/api/speedtests", headers=h, json={"ping_ms": 40, "download_mbps": 9.5, "upload_mbps": 2}).json()
    r = client.post("/api/tickets", headers=h, json={
        "subject": "Very slow", "message": "Only 9 Mbps", "category": "connection", "speed_test_id": st["id"]})
    assert r.status_code == 201
    t = client.get(f"/api/tickets/{r.json()['id']}", headers=h).json()
    assert t["speed_test"]["download_mbps"] == 9.5


def test_cannot_attach_someone_elses_speed_test(client, auth_headers):
    sara = auth_headers(client, "sara@myterra.app", "sara1234")
    st = client.post("/api/speedtests", headers=sara, json={"ping_ms": 40, "download_mbps": 9.5, "upload_mbps": 2}).json()
    r = client.post("/api/tickets", headers=auth_headers(client), json={
        "subject": "x", "message": "y", "category": "connection", "speed_test_id": st["id"]})
    assert r.status_code == 422


def test_customer_reply_reopens_resolved_ticket(client, auth_headers):
    h = auth_headers(client)
    tid = first_ticket(client, h)["id"]
    r = client.post(f"/api/tickets/{tid}/messages", headers=h, json={"body": "It happened again tonight."})
    assert r.status_code == 201
    t = client.get(f"/api/tickets/{tid}", headers=h).json()
    assert t["status"] == "open" and t["messages"][-1]["from_staff"] is False


def test_staff_reply_and_status_notify_customer(client, auth_headers, admin):
    h = auth_headers(client)
    tid = first_ticket(client, h)["id"]
    client.post(f"/api/admin/tickets/{tid}/messages", headers=admin, json={"body": "Checking now."})
    notes = client.get("/api/notifications", headers=h).json()["items"]
    assert notes[0]["kind"] == "ticket" and notes[0]["link"] == f"/support/{tid}"
    client.patch(f"/api/admin/tickets/{tid}", headers=admin, json={"status": "in_progress"})
    assert client.get("/api/notifications", headers=h).json()["unread"] == 2


def test_other_customers_ticket_is_hidden(client, auth_headers):
    tid = first_ticket(client, auth_headers(client))["id"]
    sara = auth_headers(client, "sara@myterra.app", "sara1234")
    assert client.get(f"/api/tickets/{tid}", headers=sara).status_code == 404
    assert client.post(f"/api/tickets/{tid}/messages", headers=sara, json={"body": "hi"}).status_code == 404


def test_admin_ticket_detail(client, admin, auth_headers):
    tid = first_ticket(client, auth_headers(client))["id"]
    t = client.get(f"/api/admin/tickets/{tid}", headers=admin).json()
    assert t["user_email"] == "demo@myterra.app" and len(t["messages"]) == 1
