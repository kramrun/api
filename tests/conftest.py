"""Isolated SQLite database: configured before importing application modules."""
import os
import tempfile
from pathlib import Path

import pytest

_TEST_DIR = tempfile.TemporaryDirectory(prefix="game-library-pytest-")
os.environ["DATABASE_URL"] = "sqlite:///" + str(Path(_TEST_DIR.name) / "test.db")

from fastapi.testclient import TestClient
from main import app
from database.connection import Base, engine


@pytest.fixture
def client():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        Base.metadata.drop_all(bind=engine)


@pytest.fixture
def users(client):
    headers = []
    for username in ("alice_test", "bob_test"):
        response = client.post(
            "/auth/register",
            json={"username": username, "password": "test-password-123"},
        )
        assert response.status_code == 201, response.text
        headers.append({"Authorization": f"Bearer {response.json()['access_token']}"})
    return headers


@pytest.fixture
def game_payload():
    return {"title": "Portal 2", "genre": "Puzzle", "year": 2011, "rating": 9.5}
