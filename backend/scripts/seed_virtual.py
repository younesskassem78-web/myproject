"""Fill the database with realistic virtual customers, so every screen has something to show.

    python scripts/seed_virtual.py           add them (refuses if they're already there)
    python scripts/seed_virtual.py --remove  delete every virtual user and application again

Every virtual address ends in @myterra.test: a reserved test domain that can't receive mail (the app never
emails it) and a marker that makes them easy to remove. Rows go straight into the database, so nothing is
emailed while seeding.
"""
import random
import sys
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import db  # loads backend/.env  # noqa: E402
from app.routers.billing import DUE_DAYS, invoice_number  # noqa: E402

DOMAIN = "myterra.test"
TESTER = {"email": f"tester@{DOMAIN}", "password": "Tester123!", "name": "Karim Tester"}
VIRTUAL_PASSWORD = "Virtual123!"
COUNT = 40

FIRST = ["Rami", "Nour", "Hadi", "Maya", "Ziad", "Lea", "Karim", "Rita", "Fadi", "Yasmine", "Elie", "Hiba", "Omar",
         "Joelle", "Ali", "Christelle", "Tarek", "Dana", "Georges", "Lina", "Samir", "Carla", "Bilal", "Nadine",
         "Wael", "Farah", "Marc", "Rana", "Hassan", "Sara"]
LAST = ["Haddad", "Khoury", "Saad", "Nasr", "Aoun", "Hajj", "Chamoun", "Farhat", "Mansour", "Karam", "Salameh",
        "Rizk", "Daher", "Hamdan", "Abboud", "Fakhoury", "Jaber", "Moussa", "Nassar", "Sleiman"]
CITIES = {"Beirut": ["Hamra St", "Verdun St", "Achrafieh, Sassine Sq", "Mar Mikhael, Armenia St", "Badaro St"],
          "Tripoli": ["Azmi St", "Mina, Port Rd", "Abou Samra Rd"], "Saida": ["Riad El Solh St", "Old Souk Rd"],
          "Jounieh": ["Maameltein Highway", "Kaslik, Main Rd"], "Zahle": ["Boulevard Rd", "Hoch El Omara"],
          "Byblos": ["Old Souk Rd", "Port Rd"], "Tyre": ["Hiram St", "Corniche Rd"], "Baabda": ["Hazmieh, Main Rd"]}
TICKETS = [
    ("connection", "Internet drops every evening", "Since Monday the connection drops around 9 pm for a few minutes.",
     "We found congestion on your street cabinet and added capacity. It should be stable now."),
    ("connection", "Slower than my plan", "Speed tests show about half my plan speed on Wi-Fi.",
     "Your line tests fine. Try the 5 GHz network on your router; we've sent you the steps."),
    ("billing", "Charged twice this month?", "I see two payments on my card for the same bill.",
     "One was a pending authorisation that your bank released. Only one payment went through."),
    ("installation", "Can the technician come earlier?", "Is there any slot before 10 am?",
     "The technician can come at 9 am. We've noted it on your booking."),
    ("other", "Change my phone number", "I have a new mobile number, please update it.", None),
]
UA = ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1"]


def at(day: date, hour: int = 10) -> datetime:
    return datetime.combine(day, time(hour, random.randint(0, 59)), tzinfo=timezone.utc)


def months_between(start: date, end: date):
    m = start.replace(day=1)
    while m <= end:
        yield m
        m = (m + timedelta(days=32)).replace(day=1)


def add_customer(c, plans, today, *, name, email, password_hash, city, joined, install_status="installed",
                 install_date=None, autopay=False, balance=0, unpaid_months=0, overdue=False, extra_gb=0,
                 tickets=0, speed_tests=0, plan=None):
    plan = plan or random.choice(plans)
    card = random.choice([("Visa", "4242"), ("Mastercard", "4444"), ("Visa", "1881")])
    phone = f"+961{random.choice(['3', '70', '71', '76', '81'])}{random.randint(100000, 999999)}"
    street = random.choice(CITIES[city])
    uid = c.execute(
        "insert into users (email, name, password_hash, role, plan_id, balance, phone, address, city, created_at, "
        "autopay, card_brand, card_last4, install_status, install_date) values "
        "(%s, %s, %s, 'customer', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) returning id",
        (email, name, password_hash, plan["id"], balance, phone, f"{street}, Bldg {random.randint(1, 40)}", city,
         at(joined), autopay, card[0], card[1], install_status, install_date)).fetchone()["id"]
    c.execute("insert into payments (user_id, kind, method, amount, card_brand, card_last4, created_at) "
              "values (%s, 'signup', 'card', %s, %s, %s, %s)", (uid, plan["price"], *card, at(joined)))
    months = list(months_between(joined + timedelta(days=28), today)) if install_status == "installed" else []
    for i, period in enumerate(months):
        due = period + timedelta(days=DUE_DAYS)
        unpaid = i >= len(months) - unpaid_months
        if unpaid and overdue and i == len(months) - 1:
            due = today - timedelta(days=random.randint(2, 9))
        number = invoice_number(period, uid)
        inv = c.execute("insert into invoices (user_id, number, period, plan_name, amount, status, issued_at, due_date, "
                        "paid_at) values (%s, %s, %s, %s, %s, %s, %s, %s, %s) returning id",
                        (uid, number, period, plan["name"], plan["price"], "unpaid" if unpaid else "paid", at(period, 6),
                         due, None if unpaid else at(period + timedelta(days=random.randint(1, 10))))).fetchone()["id"]
        if not unpaid:
            c.execute("insert into payments (user_id, invoice_id, kind, method, amount, card_brand, card_last4, created_at) "
                      "values (%s, %s, 'invoice', %s, %s, %s, %s, %s)",
                      (uid, inv, "autopay" if autopay else "card", plan["price"], *card, at(period + timedelta(days=2))))
        if i == len(months) - 1:
            c.execute("insert into notifications (user_id, kind, title, body, link, created_at) values "
                      "(%s, 'invoice', 'Your bill is ready', %s, '/billing', %s)",
                      (uid, f"{number}: ${plan['price']:.2f}, due {due:%d %B}.", at(period, 6)))
    if extra_gb:
        price = {10: 3.0, 25: 6.0, 50: 10.0}[extra_gb]
        pay = c.execute("insert into payments (user_id, kind, method, amount, card_brand, card_last4) "
                        "values (%s, 'data', 'card', %s, %s, %s) returning id", (uid, price, *card)).fetchone()["id"]
        c.execute("insert into data_addons (user_id, month, gb, price, payment_id) values (%s, %s, %s, %s, %s)",
                  (uid, f"{today:%Y-%m}", extra_gb, price, pay))
    for _ in range(speed_tests):
        speed = plan.get("speed_mbps") or 100
        c.execute("insert into speed_tests (user_id, ping_ms, download_mbps, upload_mbps, created_at) values (%s, %s, %s, %s, %s)",
                  (uid, round(random.uniform(8, 40), 1), round(speed * random.uniform(0.55, 0.97), 1),
                   round(speed * random.uniform(0.2, 0.45), 1), at(today - timedelta(days=random.randint(0, 40)))))
    for category, subject, message, reply in random.sample(TICKETS, tickets):
        opened = today - timedelta(days=random.randint(1, 30))
        status = "resolved" if reply and random.random() < 0.6 else ("in_progress" if reply else "open")
        tid = c.execute("insert into tickets (user_id, subject, message, status, category, created_at, updated_at) "
                        "values (%s, %s, %s, %s, %s, %s, %s) returning id",
                        (uid, subject, message, status, category, at(opened), at(opened + timedelta(days=1)))).fetchone()["id"]
        if reply:
            c.execute("insert into ticket_messages (ticket_id, author_name, from_staff, body, created_at) "
                      "values (%s, 'MyTerra Support', true, %s, %s)", (tid, reply, at(opened + timedelta(days=1))))
    c.execute("insert into tokens (token, user_id, user_agent, ip, last_used_at) values (%s, %s, %s, %s, %s)",
              (f"{random.getrandbits(256):064x}", uid, random.choice(UA), f"185.89.{random.randint(1, 250)}.{random.randint(1, 250)}",
               at(today - timedelta(days=random.randint(0, 6)))))  # a past device, so "Signed-in devices" isn't empty
    return uid


def seed() -> None:
    random.seed(2026)
    today = date.today()
    with db.connect() as c, c.transaction():
        if c.execute("select 1 from users where email like %s", (f"%@{DOMAIN}",)).fetchone():
            sys.exit("Virtual users are already there. Remove them first: python scripts/seed_virtual.py --remove")
        plans = c.execute("select id, name, price::float8 as price, speed_mbps from plans where active order by price").fetchall()
        if not plans:
            sys.exit("Add at least one plan first.")
        shared = db.hash_password(VIRTUAL_PASSWORD)
        names = random.sample([(first, last) for first in FIRST for last in LAST], COUNT + 6)
        for i, (first, last) in enumerate(names[:COUNT]):
            joined = today - timedelta(days=random.randint(15, 240))
            pending = i < 4  # a few installations still to come
            add_customer(
                c, plans, today, name=f"{first} {last}", email=f"{first}.{last}{i}@{DOMAIN}".lower(), password_hash=shared,
                city=random.choice(list(CITIES)), joined=today - timedelta(days=random.randint(2, 10)) if pending else joined,
                install_status=("technician_assigned" if i % 2 else "scheduled") if pending else "installed",
                install_date=today + timedelta(days=random.randint(3, 12)) if pending else None,
                autopay=random.random() < 0.35, balance=random.choice([0, 0, 0, 5, 10, 25]),
                unpaid_months=random.choice([0, 0, 1, 1, 2]), overdue=random.random() < 0.25,
                extra_gb=random.choice([0, 0, 0, 0, 10, 25, 50]), tickets=random.choice([0, 0, 0, 1, 2]),
                speed_tests=random.randint(0, 4))
        # People waiting for approval, so Admin → Applications has work in it
        for first, last in names[COUNT:]:
            plan = random.choice(plans)
            city = random.choice(list(CITIES))
            c.execute("insert into applications (email, name, password_hash, plan_id, phone, birth_date, id_number, city, "
                      "street, install_date, card_brand, card_last4, amount_paid, created_at) values "
                      "(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'Visa', '4242', %s, %s)",
                      (f"{first}.{last}.applicant@{DOMAIN}".lower(), f"{first} {last}", shared, plan["id"],
                       f"+96170{random.randint(100000, 999999)}", date(random.randint(1965, 2003), random.randint(1, 12), 15),
                       f"LB{random.randint(1000000, 9999999)}", city, f"{random.choice(CITIES[city])}, Bldg 7",
                       today + timedelta(days=random.randint(4, 20)), plan["price"], at(today - timedelta(days=random.randint(0, 3)))))
        # The account for trying everything by hand
        add_customer(c, plans, today, name=TESTER["name"], email=TESTER["email"], password_hash=db.hash_password(TESTER["password"]),
                     city="Beirut", joined=today - timedelta(days=95), install_status="installed", balance=10,
                     unpaid_months=1, tickets=2, speed_tests=3, plan=plans[-1] if len(plans) > 1 else plans[0])
        c.execute("update invoices set due_date = %s where status = 'unpaid' and user_id = "
                  "(select id from users where email = %s)", (today + timedelta(days=2), TESTER["email"]))  # due soon
        c.execute("update users set install_status = 'technician_assigned', install_date = %s where email = %s",
                  (today + timedelta(days=6), TESTER["email"]))  # e.g. a router upgrade visit, so "Change date" shows
    print(f"Added {COUNT} virtual customers, {len(names) - COUNT} applications and the test account {TESTER['email']}.")


def remove() -> None:
    with db.connect() as c, c.transaction():
        users = c.execute("delete from users where email like %s", (f"%@{DOMAIN}",)).rowcount
        apps = c.execute("delete from applications where email like %s", (f"%@{DOMAIN}",)).rowcount
    print(f"Removed {users} virtual users and {apps} applications (and their bills, payments, tickets and tests).")


if __name__ == "__main__":
    remove() if "--remove" in sys.argv else seed()
