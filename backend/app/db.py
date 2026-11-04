"""PostgreSQL connection, schema and demo seed data."""
import functools
import hashlib
import hmac
import os
import secrets
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

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
-- v3 (QA audit): indexes on lookup columns, per-address sign-in limit, real foreign key for attached speed tests
alter table login_failures add column if not exists ip text;
create index if not exists login_failures_ip on login_failures (ip, created_at);
create index if not exists tickets_user on tickets (user_id, created_at desc);
create index if not exists payments_user on payments (user_id, created_at desc);
create index if not exists payments_invoice on payments (invoice_id);
create index if not exists tokens_user on tokens (user_id);
create index if not exists ticket_messages_ticket on ticket_messages (ticket_id, created_at);
create index if not exists speed_tests_user on speed_tests (user_id, created_at desc);
create index if not exists users_plan on users (plan_id);
create index if not exists applications_email on applications (email, created_at desc);
create index if not exists applications_plan on applications (plan_id);
create index if not exists audit_log_created on audit_log (created_at desc);
update tickets t set speed_test_id = null
  where speed_test_id is not null and not exists (select 1 from speed_tests s where s.id = t.speed_test_id);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tickets_speed_test_id_fkey') then
    alter table tickets add constraint tickets_speed_test_id_fkey
      foreign key (speed_test_id) references speed_tests(id) on delete set null;
  end if;
end $$;
-- v4 (audit 2): codes remember the requesting address, so one visitor can't send hundreds of emails
alter table verifications add column if not exists ip text;
create index if not exists verifications_ip on verifications (ip, created_at);
-- v5 (features): extra data packs bought during the month
create table if not exists data_addons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  month text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  gb int not null check (gb > 0),
  price numeric(8,2) not null check (price >= 0),
  payment_id uuid references payments(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists data_addons_user_month on data_addons (user_id, month);
do $$ begin
  if (select pg_get_constraintdef(oid) from pg_constraint where conname = 'payments_kind_check') not like '%data%' then
    alter table payments drop constraint payments_kind_check;
    alter table payments add constraint payments_kind_check check (kind in ('invoice', 'topup', 'signup', 'data'));
  end if;
end $$;
-- customers can move their installation visit themselves, a limited number of times
alter table users add column if not exists install_reschedules int not null default 0 check (install_reschedules >= 0);
-- email topics a customer switched off (in-app notifications always stay on)
alter table users add column if not exists email_opt_out text[] not null default '{}'
  check (email_opt_out <@ array['billing', 'outage', 'ticket', 'installation']);
-- sessions: store only a SHA-256 fingerprint of each token (a leaked database can't be used to sign in),
-- plus what customers need to recognise their signed-in devices
alter table tokens add column if not exists id uuid not null default gen_random_uuid();
alter table tokens add column if not exists user_agent text;
alter table tokens add column if not exists ip text;
alter table tokens add column if not exists last_used_at timestamptz not null default now();
create unique index if not exists tokens_id on tokens (id);
update tokens set token = encode(sha256(convert_to(token, 'UTF8')), 'hex') where length(token) <> 64;
-- one "your bill is due soon" reminder per bill
alter table invoices add column if not exists reminded_at timestamptz;
-- which server a speed test measured against ("Cloudflare, Beirut" or "MyTerra server")
alter table speed_tests add column if not exists server text;
-- v6 (automation): emails wait here until the background sender delivers them (survives restarts, never sent
-- for a transaction that rolled back), and scheduled jobs record when they last ran
create table if not exists email_outbox (
  id uuid primary key default gen_random_uuid(),
  to_addr text not null,
  subject text not null,
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts int not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists email_outbox_due on email_outbox (status, next_attempt_at);
create table if not exists job_runs (
  name text primary key,
  last_run_on date,
  last_run_at timestamptz,
  last_result text
);
"""


# OWASP (2023) recommends 600,000 rounds for PBKDF2-SHA256. Tests lower it through the environment to stay fast.
ITERATIONS = int(os.environ.get("PASSWORD_ITERATIONS", "600000"))
LEGACY_ITERATIONS = 200_000  # hashes stored before the format recorded its round count


def _digest(password: str, salt: str, rounds: int) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), rounds).hex()


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    return f"pbkdf2_sha256${ITERATIONS}${salt}${_digest(password, salt, ITERATIONS)}"


def verify_password(password: str, stored: str) -> bool:
    parts = stored.split("$")
    if len(parts) == 4:
        _, rounds, salt, digest = parts
        return hmac.compare_digest(digest, _digest(password, salt, int(rounds)))
    salt, digest = parts
    return hmac.compare_digest(digest, _digest(password, salt, LEGACY_ITERATIONS))


def needs_rehash(stored: str) -> bool:
    parts = stored.split("$")
    return len(parts) != 4 or int(parts[1]) != ITERATIONS


@functools.cache
def _seed_hash(password: str) -> str:
    return hash_password(password)


def connect():
    return psycopg.connect(os.environ["DATABASE_URL"], autocommit=True, row_factory=dict_row)


_pool: ConnectionPool | None = None


def pool() -> ConnectionPool:
    """Shared connections, opened once and reused: a new PostgreSQL login costs tens of milliseconds."""
    global _pool
    if _pool is None:
        _pool = ConnectionPool(os.environ["DATABASE_URL"], min_size=1, max_size=int(os.environ.get("DB_POOL_SIZE", "10")),
                               kwargs={"autocommit": True, "row_factory": dict_row}, open=True)
    return _pool


def get_db():
    with pool().connection() as conn:
        yield conn


def init(reset: bool = False) -> None:
    """Create tables and add demo data to an empty database."""
    with connect() as c:
        if reset:
            c.execute("drop table if exists email_outbox, job_runs, data_addons, usage_alerts, login_failures, audit_log, speed_tests, ticket_messages, "
                      "notifications, outages, payments, invoices, verifications, tickets, tokens, applications, "
                      "users, plans cascade")
        c.execute(SCHEMA)
        if os.environ.get("DEMO_DATA", "true").lower() == "false":
            _ensure_admin(c)
            return
        if not c.execute("select 1 from plans limit 1").fetchone():
            _seed(c)
        if not c.execute("select 1 from invoices limit 1").fetchone():
            _seed_v2(c)


def _ensure_admin(c) -> None:
    """Production: create the first admin from ADMIN_EMAIL / ADMIN_PASSWORD instead of demo accounts."""
    email, password = os.environ.get("ADMIN_EMAIL"), os.environ.get("ADMIN_PASSWORD")
    if email and password and not c.execute("select 1 from users where role = 'admin'").fetchone():
        c.execute("insert into users (email, name, password_hash, role) values (%s, 'Admin', %s, 'admin')",
                  (email.strip().lower(), hash_password(password)))


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
