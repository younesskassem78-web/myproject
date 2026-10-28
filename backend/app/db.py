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
create table if not exists verifications (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('email', 'sms')),
  target text not null,
  code_hash text not null,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  verified_at timestamptz,
  used_at timestamptz
);
create index if not exists verifications_target on verifications (channel, target, created_at desc);
-- columns added after the first release; "if not exists" keeps existing databases working
alter table users add column if not exists phone text;
alter table users add column if not exists address text;
alter table applications add column if not exists phone text;
alter table applications add column if not exists birth_date date;
alter table applications add column if not exists id_number text;
alter table applications add column if not exists city text;
alter table applications add column if not exists street text;
alter table applications add column if not exists apartment text;
alter table applications add column if not exists install_date date;
alter table applications add column if not exists card_brand text;
alter table applications add column if not exists card_last4 text;
alter table applications add column if not exists amount_paid numeric(8,2);
-- v2
alter table plans add column if not exists speed_mbps int not null default 100;
alter table users add column if not exists city text;
alter table users add column if not exists autopay boolean not null default false;
alter table users add column if not exists card_brand text;
alter table users add column if not exists card_last4 text;
alter table users add column if not exists install_status text
  check (install_status in ('scheduled', 'technician_assigned', 'installed'));
alter table users add column if not exists install_date date;
alter table tokens add column if not exists expires_at timestamptz not null default now() + interval '30 days';
alter table tickets add column if not exists category text not null default 'other'
  check (category in ('connection', 'billing', 'installation', 'other'));
alter table tickets add column if not exists speed_test_id uuid;
alter table tickets add column if not exists updated_at timestamptz not null default now();
create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  number text not null unique,
  period date not null,
  plan_name text not null,
  amount numeric(10,2) not null check (amount >= 0),
  status text not null default 'unpaid' check (status in ('unpaid', 'paid', 'void')),
  issued_at timestamptz not null default now(),
  due_date date not null,
  paid_at timestamptz,
  unique (user_id, period)
);
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  invoice_id uuid references invoices(id) on delete set null,
  kind text not null check (kind in ('invoice', 'topup', 'signup')),
  method text not null check (method in ('card', 'balance', 'autopay')),
  amount numeric(10,2) not null check (amount > 0),
  card_brand text,
  card_last4 text,
  created_at timestamptz not null default now()
);
create table if not exists outages (
  id uuid primary key default gen_random_uuid(),
  city text not null,
  title text not null,
  message text not null,
  status text not null default 'investigating'
    check (status in ('investigating', 'identified', 'monitoring', 'resolved')),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  link text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user on notifications (user_id, created_at desc);
create table if not exists ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets(id) on delete cascade,
  author_name text not null,
  from_staff boolean not null,
  body text not null,
  created_at timestamptz not null default now()
);
create table if not exists speed_tests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  ping_ms numeric(8,1) not null,
  download_mbps numeric(10,1) not null,
  upload_mbps numeric(10,1) not null,
  created_at timestamptz not null default now()
);
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_email text not null,
  action text not null,
  target text not null,
  created_at timestamptz not null default now()
);
create table if not exists login_failures (
  email text not null,
  created_at timestamptz not null default now()
);
create index if not exists login_failures_email on login_failures (email, created_at);
create table if not exists usage_alerts (
  user_id uuid not null references users(id) on delete cascade,
  month text not null,
  level int not null,
  primary key (user_id, month, level)
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
            c.execute("drop table if exists usage_alerts, login_failures, audit_log, speed_tests, ticket_messages, "
                      "notifications, outages, payments, invoices, verifications, tickets, tokens, applications, "
                      "users, plans cascade")
        c.execute(SCHEMA)
        if not c.execute("select 1 from plans limit 1").fetchone():
            _seed(c)
        if not c.execute("select 1 from invoices limit 1").fetchone():
            _seed_v2(c)


def _seed(c) -> None:
    add_plan = "insert into plans (name, data_gb, price, speed_mbps) values (%s, %s, %s, %s) returning id"
    p50 = c.execute(add_plan, ("Fiber 50 GB", 50, 20, 100)).fetchone()["id"]
    p100 = c.execute(add_plan, ("Fiber 100 GB", 100, 30, 300)).fetchone()["id"]
    c.execute(add_plan, ("Fiber Unlimited", 1000, 45, 1000))
    add_user = ("insert into users (email, name, password_hash, role, plan_id, balance, city, phone, address, "
                "install_status) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) returning id")
    c.execute(add_user, ("admin@myterra.app", "Admin", _seed_hash("admin1234"), "admin", None, 0,
                         None, None, None, None))
    demo = c.execute(add_user, ("demo@myterra.app", "Demo User", _seed_hash("demo1234"), "customer", p50, 5,
                                "Beirut", "+96170000001", "Hamra St, Bldg 12, 3rd floor, Beirut",
                                "installed")).fetchone()["id"]
    c.execute(add_user, ("sara@myterra.app", "Sara", _seed_hash("sara1234"), "customer", p100, 12.5,
                         "Tripoli", "+96170000002", "Mina Rd, Bldg 3, Tripoli", "installed"))
    c.execute("insert into tickets (user_id, subject, message, status, category, created_at) "
              "values (%s, %s, %s, 'resolved', 'connection', %s)",
              (demo, "Slow internet in the evening", "Speed drops after 8 pm.", "2026-10-03T19:42:00Z"))


def _seed_v2(c) -> None:
    """Billing history, an outage and a support reply so the demo looks lived-in."""
    c.execute("update plans set speed_mbps = 300 where name = 'Fiber 100 GB' and speed_mbps = 100")
    c.execute("update users set city = 'Beirut' where email = 'demo@myterra.app' and city is null")
    c.execute("update users set city = 'Tripoli' where email = 'sara@myterra.app' and city is null")
    customers = c.execute("select u.id, u.email, p.name, p.price from users u join plans p on p.id = u.plan_id "
                          "where u.email in ('demo@myterra.app', 'sara@myterra.app')").fetchall()
    for u in customers:
        for months_ago in (2, 1, 0):
            paid = months_ago > 0
            inv = c.execute(
                "insert into invoices (user_id, number, period, plan_name, amount, status, issued_at, due_date, "
                "paid_at) select %(u)s, 'INV-' || to_char(m, 'YYYYMM') || '-' || upper(substr(%(u)s::text, 1, 8)), "
                "m, %(plan)s, %(amount)s, %(status)s, "
                "case when %(ago)s = 0 then now() - interval '2 days' else m end, "
                "case when %(ago)s = 0 then current_date + 13 else (m + interval '15 days')::date end, "
                "case when %(paid)s then m + interval '3 days' end "
                "from (select (date_trunc('month', now()) - make_interval(months => %(ago)s))::date as m) s "
                "returning id",
                {"u": u["id"], "plan": u["name"], "amount": u["price"], "status": "paid" if paid else "unpaid",
                 "paid": paid, "ago": months_ago}).fetchone()["id"]
            if paid:
                c.execute("insert into payments (user_id, invoice_id, kind, method, amount, card_brand, card_last4, "
                          "created_at) select %s, %s, 'invoice', 'card', %s, 'Visa', '4242', paid_at "
                          "from invoices where id = %s", (u["id"], inv, u["price"], inv))
    demo = next((u for u in customers if u["email"] == "demo@myterra.app"), None)
    if demo:
        t = c.execute("select id from tickets where user_id = %s order by created_at limit 1",
                      (demo["id"],)).fetchone()
        if t:
            c.execute("insert into ticket_messages (ticket_id, author_name, from_staff, body, created_at) "
                      "values (%s, 'MyTerra Support', true, %s, %s)",
                      (t["id"], "We found congestion on your street cabinet and upgraded it. Speeds should be "
                                "back to normal. Reply here if it happens again.", "2026-10-04T10:15:00Z"))
    c.execute("insert into outages (city, title, message, status, started_at, updated_at) values "
              "('Tripoli', 'Slow speeds in parts of Tripoli', 'A damaged fibre cable near Mina is reducing "
              "speeds. Technicians are on site.', 'identified', now() - interval '3 hours', "
              "now() - interval '1 hour')")
    c.execute("insert into outages (city, title, message, status, started_at, updated_at, resolved_at) values "
              "('Beirut', 'Planned maintenance in Hamra', 'Night maintenance finished on time.', 'resolved', "
              "now() - interval '5 days', now() - interval '5 days' + interval '4 hours', "
              "now() - interval '5 days' + interval '4 hours')")
