"""Support tickets with a message thread, for customers and staff."""
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from app import events
from app.deps import DB, Admin, Limit, Offset, Text, User, paged

router = APIRouter()

Category = Literal["connection", "billing", "installation", "other"]
Status = Literal["open", "in_progress", "resolved"]
STATUS_LABEL = {"open": "Open", "in_progress": "In progress", "resolved": "Resolved"}
TICKET_COLS = "t.id, t.subject, t.message, t.status, t.category, t.created_at, t.updated_at"


def ticket_detail(conn, ticket_id: UUID, user_id: UUID | None = None) -> dict:
    """One ticket with its messages and attached speed test. `user_id` limits it to that customer's tickets."""
    t = conn.execute(f"select {TICKET_COLS}, t.user_id, t.speed_test_id, u.email as user_email, u.name as user_name "
                     "from tickets t join users u on u.id = t.user_id where t.id = %s and (%s::uuid is null or t.user_id = %s)",
                     (ticket_id, user_id, user_id)).fetchone()
    if not t:
        raise HTTPException(404, "Ticket not found")
    t["messages"] = conn.execute("select id, author_name, from_staff, body, created_at from ticket_messages "
                                 "where ticket_id = %s order by created_at", (ticket_id,)).fetchall()
    t["speed_test"] = conn.execute("select id, ping_ms::float8 as ping_ms, download_mbps::float8 as download_mbps, "
                                   "upload_mbps::float8 as upload_mbps, created_at from speed_tests where id = %s",
                                   (t.pop("speed_test_id"),)).fetchone()
    del t["user_id"]
    return t


# ---------- customer ----------

class NewTicket(BaseModel):
    subject: Text(100)
    message: Text(1000)
    category: Category = "other"
    speed_test_id: UUID | None = None


class NewMessage(BaseModel):
    body: Text(2000)


@router.get("/api/tickets")
def tickets(user: User, conn: DB):
    return conn.execute(f"select {TICKET_COLS} from tickets t where t.user_id = %s order by t.created_at desc",
                        (user["id"],)).fetchall()


@router.post("/api/tickets", status_code=201)
def create_ticket(body: NewTicket, user: User, conn: DB):
    if body.speed_test_id and not conn.execute("select 1 from speed_tests where id = %s and user_id = %s",
                                               (body.speed_test_id, user["id"])).fetchone():
        raise HTTPException(422, "That speed test isn't on your account")
    return conn.execute("insert into tickets (user_id, subject, message, category, speed_test_id) "
                        "values (%s, %s, %s, %s, %s) returning id, subject, message, status, category, created_at, "
                        "updated_at", (user["id"], body.subject, body.message, body.category, body.speed_test_id)).fetchone()


@router.get("/api/tickets/{ticket_id}")
def get_ticket(ticket_id: UUID, user: User, conn: DB):
    t = ticket_detail(conn, ticket_id, user["id"])
    del t["user_email"], t["user_name"]
    return t


@router.post("/api/tickets/{ticket_id}/messages", status_code=201)
def reply(ticket_id: UUID, body: NewMessage, user: User, conn: DB):
    ticket_detail(conn, ticket_id, user["id"])  # 404 unless it's theirs
    with conn.transaction():
        msg = conn.execute("insert into ticket_messages (ticket_id, author_name, from_staff, body) "
                           "values (%s, %s, false, %s) returning id, author_name, from_staff, body, created_at",
                           (ticket_id, user["name"], body.body)).fetchone()
        # A reply on a resolved ticket means the problem is back.
        conn.execute("update tickets set updated_at = now(), status = case when status = 'resolved' then 'open' "
                     "else status end where id = %s", (ticket_id,))
    return msg


# ---------- staff ----------

class StatusChange(BaseModel):
    status: Status


@router.get("/api/admin/tickets")
def list_all_tickets(_: Admin, conn: DB, response: Response, limit: Limit = 500, offset: Offset = 0):
    return paged(conn, response, f"select {TICKET_COLS}, u.email as user_email, u.name as user_name, "
                        "(select count(*)::int from ticket_messages m where m.ticket_id = t.id) as replies "
                        "from tickets t join users u on u.id = t.user_id "
                        "order by (t.status = 'resolved'), t.updated_at desc, t.id", (), limit, offset)


@router.get("/api/admin/tickets/{ticket_id}")
def admin_ticket(ticket_id: UUID, _: Admin, conn: DB):
    return ticket_detail(conn, ticket_id)


@router.post("/api/admin/tickets/{ticket_id}/messages", status_code=201)
def staff_reply(ticket_id: UUID, body: NewMessage, admin: Admin, conn: DB):
    t = ticket_detail(conn, ticket_id)
    with conn.transaction():
        msg = conn.execute("insert into ticket_messages (ticket_id, author_name, from_staff, body) "
                           "values (%s, 'MyTerra Support', true, %s) "
                           "returning id, author_name, from_staff, body, created_at", (ticket_id, body.body)).fetchone()
        conn.execute("update tickets set updated_at = now(), status = case when status = 'open' then 'in_progress' "
                     "else status end where id = %s", (ticket_id,))
        owner = conn.execute("select user_id from tickets where id = %s", (ticket_id,)).fetchone()["user_id"]
        events.notify_user(conn, owner, "ticket", f"Support replied: {t['subject']}", body.body[:200],
                           f"/support/{ticket_id}", email_to=t["user_email"])
        events.audit(conn, admin, "replied to ticket", t["subject"])
    return msg


@router.patch("/api/admin/tickets/{ticket_id}")
def update_ticket(ticket_id: UUID, body: StatusChange, admin: Admin, conn: DB):
    with conn.transaction():
        old = conn.execute("select status, subject, user_id from tickets where id = %s for update",
                           (ticket_id,)).fetchone()
        if not old:
            raise HTTPException(404, "Ticket not found")
        row = conn.execute("update tickets set status = %s, updated_at = now() where id = %s returning id, status",
                           (body.status, ticket_id)).fetchone()
        if old["status"] != body.status:
            events.notify_user(conn, old["user_id"], "ticket",
                               f"Ticket {STATUS_LABEL[body.status].lower()}: {old['subject']}",
                               f"Your ticket is now {STATUS_LABEL[body.status].lower()}.", f"/support/{ticket_id}")
            events.audit(conn, admin, f"set ticket to {STATUS_LABEL[body.status].lower()}", old["subject"])
    return row
