def test_download_sends_the_bytes_asked_for(client, auth_headers):
    r = client.get("/api/speedtest/download?mb=1", headers=auth_headers(client))
    assert r.status_code == 200 and len(r.content) == 1024 * 1024


def test_download_is_capped(client, auth_headers):
    assert client.get("/api/speedtest/download?mb=100", headers=auth_headers(client)).status_code == 422


def test_upload_counts_bytes(client, auth_headers):
    r = client.post("/api/speedtest/upload", headers=auth_headers(client), content=b"x" * 5000)
    assert r.json() == {"received": 5000}


def test_needs_sign_in(client):
    assert client.get("/api/speedtest/download?mb=1").status_code == 401


def test_save_and_history(client, auth_headers):
    h = auth_headers(client)
    r = client.post("/api/speedtests", headers=h, json={"ping_ms": 12.3, "download_mbps": 88.4, "upload_mbps": 40.1})
    assert r.status_code == 201
    hist = client.get("/api/speedtests", headers=h).json()
    assert hist["plan_speed_mbps"] == 100 and hist["results"][0]["download_mbps"] == 88.4


def test_rejects_nonsense(client, auth_headers):
    r = client.post("/api/speedtests", headers=auth_headers(client), json={"ping_ms": -1, "download_mbps": 1, "upload_mbps": 1})
    assert r.status_code == 422
