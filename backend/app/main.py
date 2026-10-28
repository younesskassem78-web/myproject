from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import db
from app.routers import admin, customer, public


@asynccontextmanager
async def lifespan(_):
    db.init()
    yield


app = FastAPI(title="MyTerra API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:4200"],
                   allow_methods=["*"], allow_headers=["*"])
for r in (public, customer, admin):
    app.include_router(r.router)
