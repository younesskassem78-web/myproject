"""PostgreSQL connection, schema and demo seed data."""
import functools
import hashlib
import hmac
import os
import secrets
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

_env = Path(__file__).resolve().parent.parent / ".env"
if _env.exists():
    for line in _env.read_text().splitlines():
        key, sep, value = line.partition("=")
        if sep and not key.startswith("#"):
            os.environ.setdefault(key.strip(), value.strip())

SCHEMA = """
create table if not exists plans (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  data_gb int not null check (data_gb > 0),
  price numeric(8,2) not null check (price >= 0),
  active boolean not null default true
);
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  password_hash text not null,
  role text not null default 'customer' check (role in ('customer', 'admin')),
  plan_id uuid references plans(id),
  balance numeric(10,2) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists applications (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text not null,
  password_hash text not null,
  plan_id uuid not null references plans(id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);
create unique index if not exists one_pending_application_per_email on applications (email) where status = 'pending';
create table if not exists tokens (
  token text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  subject text not null,
  message text not null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  created_at timestamptz not null default now()
);
"""


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    return salt + "$" + hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 200_000).hex()


def verify_password(password: str, stored: str) -> bool:
    salt, _, digest = stored.partition("$")
    return hmac.compare_digest(digest, hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 200_000).hex())


@functools.cache
def _seed_hash(password: str) -> str:
    return hash_password(password)


def connect():
    return psycopg.connect(os.environ["DATABASE_URL"], autocommit=True, row_factory=dict_row)


def get_db():
    # shortcut: one connection per request, add psycopg_pool if traffic grows
    with connect() as conn:
        yield conn


def init(reset: bool = False) -> None:
    """Create tables and add demo data to an empty database."""
    with connect() as c:
        if reset:
            c.execute("drop table if exists tickets, tokens, applications, users, plans cascade")
        c.execute(SCHEMA)
        if c.execute("select 1 from plans limit 1").fetchone():
            return
        add_plan = "insert into plans (name, data_gb, price) values (%s, %s, %s) returning id"
        p50 = c.execute(add_plan, ("Fiber 50 GB", 50, 20)).fetchone()["id"]
        p100 = c.execute(add_plan, ("Fiber 100 GB", 100, 30)).fetchone()["id"]
        add_user = ("insert into users (email, name, password_hash, role, plan_id, balance) "
                    "values (%s, %s, %s, %s, %s, %s) returning id")
        c.execute(add_user, ("admin@myterra.app", "Admin", _seed_hash("admin1234"), "admin", None, 0))
        demo = c.execute(add_user, ("demo@myterra.app", "Demo User", _seed_hash("demo1234"), "customer", p50, 5)).fetchone()["id"]
        c.execute(add_user, ("sara@myterra.app", "Sara", _seed_hash("sara1234"), "customer", p100, 12.5))
        c.execute("insert into tickets (user_id, subject, message, status, created_at) values (%s, %s, %s, 'resolved', %s)",
                  (demo, "Slow internet in the evening", "Speed drops after 8 pm.", "2026-10-03T19:42:00Z"))
