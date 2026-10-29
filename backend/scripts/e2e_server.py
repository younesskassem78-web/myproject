"""API server for browser (Playwright) tests: wipes the E2E database, loads demo data, serves on port 8011."""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import db  # noqa: E402  (loads backend/.env)

url = os.environ.get("E2E_DATABASE_URL", "")
if not url.rsplit("/", 1)[-1].endswith("_e2e"):
    sys.exit("Refusing to start: E2E_DATABASE_URL must point at a database whose name ends in _e2e.")
os.environ["DATABASE_URL"] = url
os.environ["DEMO_DATA"] = "true"
os.environ["PASSWORD_ITERATIONS"] = os.environ.get("PASSWORD_ITERATIONS", "1000")
for key in ("GMAIL_USER", "GMAIL_APP_PASSWORD", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"):
    os.environ.pop(key, None)  # browser tests never send real email or SMS

db.ITERATIONS = int(os.environ["PASSWORD_ITERATIONS"])
db.init(reset=True)

import uvicorn  # noqa: E402

uvicorn.run("app.main:app", host="127.0.0.1", port=8011, log_level="warning")
