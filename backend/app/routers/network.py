"""Network status: public outage page, and outage management for staff."""
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app import events
from app.deps import DB, Admin, Text
from app.routers.customer import OUTAGE_COLS

router = APIRouter()
OutageStatus = Literal["investigating", "identified", "monitoring", "resolved"]


@router.get("/api/status")
def status(conn: DB):
    active = conn.execute(f"select {OUTAGE_COLS} from outages where status <> 'resolved' "
                          "order by started_at desc").fetchall()
    recent = conn.execute(f"select {OUTAGE_COLS} from outages where status = 'resolved' "
                          "and resolved_at > now() - interval '7 days' order by resolved_at desc").fetchall()
    return {"active": active, "recent": recent}


class NewOutage(BaseModel):
    city: Text(60)
    title: Text(120)
    message: Text(1000)
    status: Literal["investigating", "identified", "monitoring"] = "investigating"


class OutageChange(BaseModel):
    title: Text(120) | None = None
    message: Text(1000) | None = None
    status: OutageStatus | None = None


def _tell_city(conn, outage: dict, title: str) -> None:
    # shortcut: emails go out one by one inside the request; move to a background job for large cities
    for u in conn.execute("select id, email from users where role = 'customer' and active "
                          "and lower(city) = lower(%s)", (outage["city"],)).fetchall():
        events.notify_user(conn, u["id"], "outage", title, outage["message"], "/dashboard", email_to=u["email"])


@router.get("/api/admin/outages")
def list_outages(_: Admin, conn: DB):
    return conn.execute(f"select {OUTAGE_COLS} from outages order by (status = 'resolved'), started_at desc "
                        "limit 100").fetchall()


@router.post("/api/admin/outages", status_code=201)
def open_outage(body: NewOutage, admin: Admin, conn: DB):
    with conn.transaction():
        o = conn.execute(f"insert into outages (city, title, message, status) values (%s, %s, %s, %s) "
                         f"returning {OUTAGE_COLS}", (body.city, body.title, body.message, body.status)).fetchone()
        _tell_city(conn, o, f"Service issue in {o['city']}: {o['title']}")
        events.audit(conn, admin, "opened outage", f"{o['city']}: {o['title']}")
    return o


@router.patch("/api/admin/outages/{outage_id}")
def update_outage(outage_id: UUID, body: OutageChange, admin: Admin, conn: DB):
    ch = body.model_dump(exclude_none=True)
    with conn.transaction():
        o = conn.execute(
            f"update outages set title = coalesce(%(title)s, title), message = coalesce(%(message)s, message), "
            f"status = coalesce(%(status)s, status), updated_at = now(), "
            f"resolved_at = case when coalesce(%(status)s, status) = 'resolved' then coalesce(resolved_at, now()) end "
            f"where id = %(id)s returning {OUTAGE_COLS}",
            {"title": ch.get("title"), "message": ch.get("message"), "status": ch.get("status"), "id": outage_id},
        ).fetchone()
        if not o:
            raise HTTPException(404, "Outage not found")
        word = "Resolved" if o["status"] == "resolved" else "Update"
        _tell_city(conn, o, f"{word}: {o['title']}")
        events.audit(conn, admin, "updated outage", f"{o['city']}: {o['title']} ({o['status']})")
    return o
