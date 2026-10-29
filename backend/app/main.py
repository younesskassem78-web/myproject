import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app import db
from app.routers import admin, billing, customer, network, public, speedtest, support

PRODUCTION = os.environ.get("APP_ENV", "development") == "production"
CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:4200").split(",") if o.strip()]


@asynccontextmanager
async def lifespan(_):
    db.init()
    yield
    if db._pool:
        db._pool.close()


app = FastAPI(title="MyTerra API", lifespan=lifespan, redoc_url=None,
              docs_url=None if PRODUCTION else "/docs", openapi_url=None if PRODUCTION else "/openapi.json")
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["GET", "POST", "PATCH", "DELETE"],
                   allow_headers=["Authorization", "Content-Type"])


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")  # account data must not sit in shared caches
    return response


for r in (public, customer, billing, support, speedtest, network, admin):
    app.include_router(r.router)
