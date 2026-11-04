"""Rehearse a schema upgrade on a copy of the real data before it touches the real database.

    python scripts/rehearse_upgrade.py            back up the real database, then rehearse on a copy
    python scripts/rehearse_upgrade.py FILE.dump  rehearse on a copy restored from an existing backup

Steps: back up → restore into a throwaway database → run the upgrade twice → compare row counts in every
table (an upgrade must never lose or duplicate rows) → drop the copy. Exits non-zero if anything differs.
"""
import os
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import db  # loads backend/.env  # noqa: E402

BACKUPS = Path(__file__).resolve().parents[2] / "backups"


def tool(name: str) -> str:
    """pg_dump/pg_restore/psql from PATH, or from the default Windows install."""
    found = shutil.which(name) or str(Path(r"C:\Program Files\PostgreSQL\16\bin") / f"{name}.exe")
    if not Path(found).exists():
        sys.exit(f"{name} not found: install the PostgreSQL client tools")
    return found


def counts(url: str) -> dict:
    with db.psycopg.connect(url, row_factory=db.dict_row) as c:
        tables = [r["tablename"] for r in c.execute("select tablename from pg_tables where schemaname = 'public' order by 1")]
        return {t: c.execute(f'select count(*) n from "{t}"').fetchone()["n"] for t in tables}


def main() -> None:
    real = os.environ["DATABASE_URL"]
    if len(sys.argv) > 1:
        dump = Path(sys.argv[1])
    else:
        BACKUPS.mkdir(exist_ok=True)
        dump = BACKUPS / f"myterra-{datetime.now():%Y%m%d-%H%M%S}.dump"
        subprocess.run([tool("pg_dump"), "-Fc", "-d", real, "-f", str(dump)], check=True)
        print(f"backup: {dump}")
    copy = real.rsplit("/", 1)[0] + "/myterra_rehearsal"
    subprocess.run([tool("psql"), "-q", "-d", real, "-c", "drop database if exists myterra_rehearsal",
                    "-c", "create database myterra_rehearsal"], check=True, capture_output=True)
    try:
        subprocess.run([tool("pg_restore"), "-d", copy, str(dump)], check=True)
        before = counts(copy)
        os.environ["DATABASE_URL"] = copy
        os.environ["DEMO_DATA"] = "false"  # never seed demo rows into a copy of real data
        os.environ.setdefault("ADMIN_EMAIL", "")
        db.init()
        once = counts(copy)
        db.init()
        twice = counts(copy)
        new_tables = sorted(set(once) - set(before))
        changed = {t: (before[t], once[t], twice[t]) for t in before if not before[t] == once[t] == twice[t]}
        print(f"tables: {len(before)} before, {len(twice)} after" + (f" (new: {', '.join(new_tables)})" if new_tables else ""))
        print(f"rows: {sum(before.values())} before, {sum(twice[t] for t in before)} after two upgrades")
        if changed or once != twice:
            sys.exit(f"ROW COUNTS CHANGED: {changed}")
        print("rehearsal OK: the upgrade is safe to apply")
    finally:
        os.environ["DATABASE_URL"] = real
        subprocess.run([tool("psql"), "-q", "-d", real, "-c", "drop database if exists myterra_rehearsal"],
                       check=True, capture_output=True)


if __name__ == "__main__":
    main()
