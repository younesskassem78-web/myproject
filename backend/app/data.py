"""Fake in-memory data. Everything resets when the server restarts."""
import copy
import hashlib
import random
from datetime import date


def hash_password(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000).hex()


PLANS = {
    "fiber50": {"id": "fiber50", "name": "Fiber 50 GB", "data_gb": 50, "price": 20.0},
    "fiber100": {"id": "fiber100", "name": "Fiber 100 GB", "data_gb": 100, "price": 30.0},
}

_SEED_USERS = {
    "demo@myterra.app": {"email": "demo@myterra.app", "name": "Demo User",
                         "password_hash": hash_password("demo1234", "demo@myterra.app"),
                         "plan_id": "fiber50", "balance": 5.0},
    "sara@myterra.app": {"email": "sara@myterra.app", "name": "Sara",
                         "password_hash": hash_password("sara1234", "sara@myterra.app"),
                         "plan_id": "fiber100", "balance": 12.5},
}

_SEED_TICKETS = [
    {"id": 1, "email": "demo@myterra.app", "subject": "Slow internet in the evening",
     "message": "Speed drops after 8 pm.", "status": "resolved", "created_at": "2026-10-03T19:42:00"},
]

USERS: dict = {}
TICKETS: list = []
TOKENS: dict = {}  # token -> email


def reset() -> None:
    USERS.clear()
    USERS.update(copy.deepcopy(_SEED_USERS))
    TICKETS[:] = copy.deepcopy(_SEED_TICKETS)
    TOKENS.clear()


def daily_usage(email: str, today: date) -> list[dict]:
    rng = random.Random(f"{email}-{today:%Y-%m}")
    return [{"day": d, "gb": round(rng.uniform(0.3, 2.5), 2)} for d in range(1, today.day + 1)]


reset()
