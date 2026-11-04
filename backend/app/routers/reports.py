"""Staff reports: revenue for a date range, and CSV exports for spreadsheets and accounting."""
import csv
import io
from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException, Response

from app.deps import DB, Admin

router = APIRouter()


def _range(start: date | None, end: date | None) -> tuple[date, date]:
    """Defaults to this month so far; refuses backwards or over-long ranges."""
    end = end or date.today()
    start = start or end.replace(day=1)
    if start > end:
        raise HTTPException(422, "The start date must be before the end date")
    if end - start > timedelta(days=366 * 3):
        raise HTTPException(422, "Pick a range of 3 years or less")
    return start, end


@router.get("/api/admin/reports/revenue")
def revenue(_: Admin, conn: DB, start: date | None = None, end: date | None = None):
    """Money in (payments), bills issued, and new customers between two dates, inclusive."""
    start, end = _range(start, end)
    span = (start, end + timedelta(days=1))
    by_kind = conn.execute("select kind, count(*)::int as count, coalesce(sum(amount), 0)::float8 as total from payments "
                           "where created_at >= %s and created_at < %s group by kind order by total desc", span).fetchall()
    by_month = conn.execute("select to_char(date_trunc('month', created_at), 'YYYY-MM') as month, "
                            "coalesce(sum(amount), 0)::float8 as total from payments "
                            "where created_at >= %s and created_at < %s group by 1 order by 1", span).fetchall()
    bills = conn.execute("select count(*)::int as issued, coalesce(sum(amount), 0)::float8 as billed, "
                         "coalesce(sum(amount) filter (where status = 'paid'), 0)::float8 as paid, "
                         "coalesce(sum(amount) filter (where status = 'unpaid'), 0)::float8 as unpaid "
                         "from invoices where issued_at >= %s and issued_at < %s", span).fetchone()
    new_customers = conn.execute("select count(*)::int as n from users where role = 'customer' "
                                 "and created_at >= %s and created_at < %s", span).fetchone()["n"]
    return {"start": start, "end": end, "received": round(sum(k["total"] for k in by_kind), 2),
            "by_kind": by_kind, "by_month": by_month, "bills": bills, "new_customers": new_customers}


EXPORTS = {
    "customers": ("select u.name, u.email, u.phone, u.city, u.address, p.name as plan, u.balance::float8 as balance, "
                  "u.autopay, u.install_status, u.active, u.created_at from users u left join plans p on p.id = u.plan_id "
                  "where u.role = 'customer' order by u.created_at", False),
    "invoices": ("select i.number, u.name as customer, u.email, i.period, i.plan_name, i.amount::float8 as amount, "
                 "i.status, i.issued_at, i.due_date, i.paid_at from invoices i join users u on u.id = i.user_id "
                 "where i.issued_at >= %s and i.issued_at < %s order by i.issued_at", True),
    "payments": ("select p.created_at, u.name as customer, u.email, p.kind, p.method, p.amount::float8 as amount, "
                 "p.card_brand, p.card_last4 from payments p join users u on u.id = p.user_id "
                 "where p.created_at >= %s and p.created_at < %s order by p.created_at", True),
}


def _cell(value) -> str:
    """Spreadsheet-safe text: a cell starting with = + - @ would run as a formula in Excel (CSV injection)."""
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


@router.get("/api/admin/export/{kind}.csv")
def export(kind: Literal["customers", "invoices", "payments"], _: Admin, conn: DB,
           start: date | None = None, end: date | None = None):
    query, dated = EXPORTS[kind]
    params = ()
    name = f"myterra-{kind}-{date.today()}.csv"
    if dated:
        start, end = _range(start, end)
        params = (start, end + timedelta(days=1))
        name = f"myterra-{kind}-{start}-to-{end}.csv"
    cur = conn.execute(query, params)
    columns = [d.name for d in cur.description]
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(columns)
    rows = cur.fetchall()
    for r in rows:
        writer.writerow([_cell(r[c]) for c in columns])
    # BOM so Excel opens accented names correctly
    return Response("﻿" + out.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})
