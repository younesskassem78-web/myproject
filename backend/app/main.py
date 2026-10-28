import hmac
import secrets
from datetime import date, datetime
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, StringConstraints

from app import data

app = FastAPI(title="MyTerra API")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:4200"],
                   allow_methods=["*"], allow_headers=["*"])


def current_user(authorization: str | None = Header(None)) -> dict:
    token = (authorization or "").removeprefix("Bearer ")
    email = data.TOKENS.get(token)
    if not email:
        raise HTTPException(401, "Not authenticated")
    return data.USERS[email]


User = Annotated[dict, Depends(current_user)]
Text = lambda n: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=n)]


class Login(BaseModel):
    email: str
    password: str


class TopUp(BaseModel):
    amount: float = Field(gt=0, le=500)


class NewTicket(BaseModel):
    subject: Text(100)
    message: Text(1000)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/login")
def login(body: Login):
    email = body.email.strip().lower()
    user = data.USERS.get(email)
    if not user or not hmac.compare_digest(user["password_hash"], data.hash_password(body.password, email)):
        raise HTTPException(401, "Invalid email or password")
    token = secrets.token_urlsafe(32)
    data.TOKENS[token] = email
    return {"token": token, "name": user["name"]}


@app.get("/api/me")
def me(user: User):
    return {"name": user["name"], "email": user["email"], "balance": user["balance"],
            "plan": data.PLANS[user["plan_id"]]}


@app.get("/api/usage")
def usage(user: User):
    today = date.today()
    days = data.daily_usage(user["email"], today)
    return {"month": f"{today:%Y-%m}", "limit_gb": data.PLANS[user["plan_id"]]["data_gb"],
            "used_gb": round(sum(d["gb"] for d in days), 2), "days": days}


@app.post("/api/topup")
def topup(body: TopUp, user: User):
    user["balance"] = round(user["balance"] + body.amount, 2)
    return {"balance": user["balance"]}


def _public(t: dict) -> dict:
    return {k: t[k] for k in ("id", "subject", "message", "status", "created_at")}


@app.get("/api/tickets")
def tickets(user: User):
    mine = [t for t in data.TICKETS if t["email"] == user["email"]]
    return [_public(t) for t in sorted(mine, key=lambda t: t["id"], reverse=True)]


@app.post("/api/tickets", status_code=201)
def create_ticket(body: NewTicket, user: User):
    ticket = {"id": max((t["id"] for t in data.TICKETS), default=0) + 1, "email": user["email"],
              "subject": body.subject, "message": body.message, "status": "open",
              "created_at": datetime.now().isoformat(timespec="seconds")}
    data.TICKETS.append(ticket)
    return _public(ticket)
