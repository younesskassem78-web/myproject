"""In-browser speed test: the browser times downloads and uploads against these endpoints."""
import os

from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field

from app.deps import DB, User

router = APIRouter()
MAX_UPLOAD = 25 * 1024 * 1024
NO_CACHE = {"Cache-Control": "no-store"}


@router.get("/api/speedtest/ping")
def ping(_: User):
    return Response(status_code=204, headers=NO_CACHE)


@router.get("/api/speedtest/download")
def download(_: User, mb: int = Query(8, ge=1, le=25)):
    return Response(os.urandom(mb * 1024 * 1024), media_type="application/octet-stream", headers=NO_CACHE)


@router.post("/api/speedtest/upload")
async def upload(request: Request, _: User):
    received = 0
    async for chunk in request.stream():
        received += len(chunk)
        if received > MAX_UPLOAD:
            raise HTTPException(413, "Upload too large")
    return {"received": received}


class Result(BaseModel):
    ping_ms: float = Field(ge=0, le=10_000)
    download_mbps: float = Field(ge=0, le=100_000)
    upload_mbps: float = Field(ge=0, le=100_000)


COLS = ("id, ping_ms::float8 as ping_ms, download_mbps::float8 as download_mbps, "
        "upload_mbps::float8 as upload_mbps, created_at")


@router.post("/api/speedtests", status_code=201)
def save(body: Result, user: User, conn: DB):
    return conn.execute(f"insert into speed_tests (user_id, ping_ms, download_mbps, upload_mbps) "
                        f"values (%s, %s, %s, %s) returning {COLS}",
                        (user["id"], body.ping_ms, body.download_mbps, body.upload_mbps)).fetchone()


@router.get("/api/speedtests")
def history(user: User, conn: DB):
    plan = conn.execute("select speed_mbps from plans where id = %s", (user["plan_id"],)).fetchone()
    results = conn.execute(f"select {COLS} from speed_tests where user_id = %s order by created_at desc limit 20",
                           (user["id"],)).fetchall()
    return {"plan_speed_mbps": plan["speed_mbps"] if plan else None, "results": results}
