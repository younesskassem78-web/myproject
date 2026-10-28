import pytest
from fastapi.testclient import TestClient

from app import data
from app.main import app


@pytest.fixture(autouse=True)
def _reset():
    data.reset()


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def auth_headers():
    def make(client, email="demo@myterra.app", password="demo1234"):
        token = client.post("/api/login", json={"email": email, "password": password}).json()["token"]
        return {"Authorization": f"Bearer {token}"}
    return make
