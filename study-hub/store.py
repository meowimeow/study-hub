"""저장소 계층.

SUPABASE_URL / SUPABASE_KEY 가 설정돼 있으면 Supabase(무료 클라우드 DB)에 저장하고,
없으면 이 폴더의 SQLite 파일(study_hub.db)에 임시로 저장한다.
임시 저장은 앱이 재시작되면 사라질 수 있다.
"""

from __future__ import annotations

import datetime as dt
import sqlite3
import uuid
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
import streamlit as st

from config import get_secret

KST = ZoneInfo("Asia/Seoul")
BUCKETS = ["시험", "연구실", "과제", "생활"]


def now() -> dt.datetime:
    return dt.datetime.now(KST)


def today() -> dt.date:
    return now().date()


# 표 정의. SQLite 생성과 schema.sql 이 모두 여기서 나온다.
SCHEMA: dict[str, list[tuple[str, str]]] = {
    "tasks": [
        ("id", "text primary key"),
        ("title", "text not null"),
        ("bucket", "text"),
        ("due", "text"),
        ("est_min", "integer"),
        ("first_step", "text"),
        ("urgency", "integer default 3"),
        ("status", "text default 'open'"),
        ("planned_for", "text"),
        ("skips", "integer default 0"),
        ("skip_day", "text"),
        ("source", "text"),
        ("parent_id", "text"),
        ("created_at", "text not null"),
        ("done_at", "text"),
    ],
    "dumps": [
        ("id", "text primary key"),
        ("raw", "text not null"),
        ("status", "text default 'pending'"),
        ("summary", "text"),
        ("created_at", "text not null"),
    ],
    "parking": [
        ("id", "text primary key"),
        ("text", "text not null"),
        ("status", "text default 'new'"),
        ("created_at", "text not null"),
    ],
    "docs": [
        ("id", "text primary key"),
        ("kind", "text"),
        ("subject", "text"),
        ("filename", "text"),
        ("summary", "text"),
        ("created_at", "text not null"),
    ],
}


def supabase_sql() -> str:
    parts = ["-- Supabase 의 SQL Editor 에 통째로 붙여넣고 Run 을 한 번만 누르면 된다.\n"]
    for table, cols in SCHEMA.items():
        body = ",\n".join(f"  {c} {t}" for c, t in cols)
        parts.append(f"create table if not exists public.{table} (\n{body}\n);")
        # RLS 를 켜고 정책을 만들지 않으면 외부(anon 키)에서는 접근이 막힌다.
        # 앱은 서버에서 secret 키로 접근하므로 영향이 없다.
        parts.append(f"alter table public.{table} enable row level security;\n")
    return "\n".join(parts)


class StoreError(Exception):
    pass


# ---------------------------------------------------------------- SQLite

class SQLiteBackend:
    kind = "temporary"

    def __init__(self, path: Path):
        self.path = path
        conn = self._conn()
        for table, cols in SCHEMA.items():
            body = ", ".join(f"{c} {t}" for c, t in cols)
            conn.execute(f"create table if not exists {table} ({body})")
        conn.commit()
        conn.close()

    def _conn(self):
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    def insert(self, table, row):
        cols = list(row)
        conn = self._conn()
        conn.execute(
            f"insert into {table} ({', '.join(cols)}) values ({', '.join('?' * len(cols))})",
            [row[c] for c in cols],
        )
        conn.commit()
        conn.close()
        return row

    def select(self, table, where=None, order=None, limit=None):
        sql, args = f"select * from {table}", []
        if where:
            sql += " where " + " and ".join(f"{k} = ?" for k in where)
            args += list(where.values())
        if order:
            col, _, direction = order.partition(".")
            sql += f" order by {col} {'desc' if direction == 'desc' else 'asc'}"
        if limit:
            sql += f" limit {int(limit)}"
        conn = self._conn()
        rows = [dict(r) for r in conn.execute(sql, args).fetchall()]
        conn.close()
        return rows

    def update(self, table, row_id, fields):
        cols = list(fields)
        conn = self._conn()
        conn.execute(
            f"update {table} set {', '.join(f'{c} = ?' for c in cols)} where id = ?",
            [fields[c] for c in cols] + [row_id],
        )
        conn.commit()
        conn.close()

    def delete(self, table, row_id):
        conn = self._conn()
        conn.execute(f"delete from {table} where id = ?", [row_id])
        conn.commit()
        conn.close()


# -------------------------------------------------------------- Supabase

class SupabaseBackend:
    kind = "supabase"

    def __init__(self, url: str, key: str):
        self.base = url.rstrip("/") + "/rest/v1"
        self.headers = {"apikey": key, "Content-Type": "application/json"}
        # 예전 방식(JWT) 키는 Authorization 헤더도 필요하다. 새 sb_secret_ 키는 apikey 만 쓴다.
        if key.startswith("eyJ"):
            self.headers["Authorization"] = f"Bearer {key}"

    def _check(self, resp):
        if resp.ok:
            return resp
        text = resp.text[:300]
        if "PGRST205" in text or "does not exist" in text:
            raise StoreError(
                "Supabase에 표가 아직 없어요. schema.sql 내용을 Supabase의 SQL Editor에서 한 번 실행해 주세요."
            )
        if resp.status_code in (401, 403):
            raise StoreError("Supabase 키가 맞지 않아요. SUPABASE_URL 과 SUPABASE_KEY 를 다시 확인해 주세요.")
        raise StoreError(f"저장소 응답 오류 {resp.status_code}: {text}")

    def _request(self, method, table, **kw):
        try:
            resp = requests.request(method, f"{self.base}/{table}", headers=kw.pop("headers", self.headers), timeout=15, **kw)
        except requests.RequestException as e:
            raise StoreError(f"Supabase에 연결하지 못했어요: {e}") from e
        return self._check(resp)

    def insert(self, table, row):
        self._request("POST", table, json=row, headers={**self.headers, "Prefer": "return=minimal"})
        return row

    def select(self, table, where=None, order=None, limit=None):
        params = {"select": "*"}
        for k, v in (where or {}).items():
            params[k] = f"eq.{v}"
        if order:
            params["order"] = order
        if limit:
            params["limit"] = str(int(limit))
        return self._request("GET", table, params=params).json()

    def update(self, table, row_id, fields):
        self._request("PATCH", table, params={"id": f"eq.{row_id}"}, json=fields,
                      headers={**self.headers, "Prefer": "return=minimal"})

    def delete(self, table, row_id):
        self._request("DELETE", table, params={"id": f"eq.{row_id}"})


@st.cache_resource
def get_backend():
    url, key = get_secret("SUPABASE_URL"), get_secret("SUPABASE_KEY")
    if url and key:
        return SupabaseBackend(url, key)
    return SQLiteBackend(Path(__file__).parent / "study_hub.db")


def backend_kind() -> str:
    return get_backend().kind


def _id() -> str:
    return uuid.uuid4().hex[:12]


# ------------------------------------------------------------------ 할 일

def _due_days(due, today_):
    if not due:
        return None
    try:
        return (dt.date.fromisoformat(due) - today_).days
    except ValueError:
        return None


def order_tasks(tasks: list[dict], today_: dt.date | None = None) -> list[dict]:
    """'지금' 화면에 무엇을 먼저 보여줄지 정하는 규칙.

    1. 오늘(또는 지난 날) 하기로 정해 둔 것
    2. 오늘 '나중에'를 덜 누른 것 (누른 일은 다른 일 뒤로 돌아간다. 다음 날이면 초기화)
    3. 마감이 3일 안 → 14일 안 → 그 외
    4. 급한 정도가 높은 것
    5. 마감이 가까운 것, 먼저 적은 것
    """
    today_ = today_ or today()

    def key(t):
        planned = t.get("planned_for")
        planned_flag = 0 if planned and planned <= today_.isoformat() else 1
        days = _due_days(t.get("due"), today_)
        due_bucket = 2 if days is None else (0 if days <= 3 else 1 if days <= 14 else 2)
        skips = (t.get("skips") or 0) if t.get("skip_day") == today_.isoformat() else 0
        return (
            planned_flag,
            skips,
            due_bucket,
            -(t.get("urgency") or 3),
            days if days is not None else 9999,
            t.get("created_at") or "",
        )

    return sorted(tasks, key=key)


def open_tasks() -> list[dict]:
    return order_tasks(get_backend().select("tasks", {"status": "open"}))


def done_today() -> list[dict]:
    rows = get_backend().select("tasks", {"status": "done"}, order="done_at.desc", limit=200)
    prefix = today().isoformat()
    return [r for r in rows if (r.get("done_at") or "").startswith(prefix)]


def add_tasks(items: list[dict], source: str, parent_id: str | None = None,
              planned_for: str | None = None) -> list[str]:
    be, ids = get_backend(), []
    for i, it in enumerate(items):
        tid = _id()
        be.insert("tasks", {
            "id": tid,
            "title": it["title"],
            "bucket": it.get("bucket") if it.get("bucket") in BUCKETS else "생활",
            "due": it.get("due"),
            "est_min": it.get("est_min"),
            "first_step": it.get("first_step"),
            "urgency": it.get("urgency") or 3,
            "status": "open",
            # 쪼갠 단계는 첫 번째만 오늘로 잡아 '지금' 맨 위에 올린다.
            "planned_for": planned_for if i == 0 else None,
            "skips": 0,
            "skip_day": None,
            "source": source,
            "parent_id": parent_id,
            "created_at": now().isoformat(timespec="seconds"),
            "done_at": None,
        })
        ids.append(tid)
    return ids


def complete_task(task_id: str):
    get_backend().update("tasks", task_id, {"status": "done", "done_at": now().isoformat(timespec="seconds")})


def skip_task(task: dict):
    day = today().isoformat()
    before = (task.get("skips") or 0) if task.get("skip_day") == day else 0
    get_backend().update("tasks", task["id"], {"skips": before + 1, "skip_day": day, "planned_for": None})


def drop_task(task_id: str):
    get_backend().update("tasks", task_id, {"status": "dropped"})


def replace_with_steps(task: dict, steps: list[dict]):
    """너무 큰 할 일을 작은 단계로 바꾼다. 원래 할 일은 '쪼개짐' 상태로 남긴다."""
    first = steps and today().isoformat()
    add_tasks(
        [{**s, "bucket": task.get("bucket"), "due": task.get("due"), "urgency": task.get("urgency")} for s in steps],
        source="split", parent_id=task["id"], planned_for=first or None,
    )
    get_backend().update("tasks", task["id"], {"status": "split"})


def plan_tomorrow(n: int = 3) -> list[dict]:
    """내일 먼저 볼 할 일 n개를 정한다. 이미 정한 것은 새로 덮어쓴다."""
    be = get_backend()
    tomorrow = (today() + dt.timedelta(days=1)).isoformat()
    tasks = open_tasks()
    for t in tasks:
        if t.get("planned_for") == tomorrow:
            be.update("tasks", t["id"], {"planned_for": None})
            t["planned_for"] = None
    # 오늘 이미 맨 위로 올려 둔 것도 후보에 들어간다. 지금 순서 그대로 위에서 n개.
    picked = [t for t in order_tasks([{**t, "planned_for": None} for t in tasks])][:n]
    for t in picked:
        be.update("tasks", t["id"], {"planned_for": tomorrow})
        t["planned_for"] = tomorrow
    return picked


def planned_for_tomorrow() -> list[dict]:
    tomorrow = (today() + dt.timedelta(days=1)).isoformat()
    return [t for t in open_tasks() if t.get("planned_for") == tomorrow]


# ------------------------------------------------------------ 쏟아내기

def add_dump(raw: str) -> str:
    did = _id()
    get_backend().insert("dumps", {"id": did, "raw": raw, "status": "pending", "summary": None,
                                    "created_at": now().isoformat(timespec="seconds")})
    return did


def finish_dump(dump_id: str, summary: str):
    get_backend().update("dumps", dump_id, {"status": "sorted", "summary": summary})


def pending_dumps() -> list[dict]:
    return get_backend().select("dumps", {"status": "pending"}, order="created_at.asc")


# ------------------------------------------------------------- 주차장

def add_parking(text: str):
    get_backend().insert("parking", {"id": _id(), "text": text.strip(), "status": "new",
                                      "created_at": now().isoformat(timespec="seconds")})


def parking_items() -> list[dict]:
    return get_backend().select("parking", {"status": "new"}, order="created_at.asc")


def mark_parking_sorted(ids: list[str]):
    for i in ids:
        get_backend().update("parking", i, {"status": "sorted"})


def delete_parking(item_id: str):
    get_backend().delete("parking", item_id)


# --------------------------------------------------------------- 자료

def add_doc(kind: str, subject: str, filename: str, summary: str):
    get_backend().insert("docs", {"id": _id(), "kind": kind, "subject": subject, "filename": filename,
                                   "summary": summary, "created_at": now().isoformat(timespec="seconds")})


def list_docs(kind: str) -> list[dict]:
    return get_backend().select("docs", {"kind": kind}, order="created_at.desc")


def delete_doc(doc_id: str):
    get_backend().delete("docs", doc_id)
