"""SQLite storage layer for Study Hub.

Everything (subjects, lab items, uploaded file bytes, generated summaries)
lives in one local SQLite file (study_hub.db) that sits next to app.py.
That file is what needs to persist/sync if you move the app between
machines or redeploy it.
"""

import sqlite3
import datetime
from pathlib import Path

DB_PATH = Path(__file__).parent / "study_hub.db"


def get_conn():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_conn()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS subjects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT NOT NULL,          -- 'subject' or 'lab'
            subject_id INTEGER,              -- NULL when category = 'lab'
            filename TEXT NOT NULL,
            file_blob BLOB NOT NULL,
            extracted_text TEXT,
            summary TEXT,
            summary_type TEXT,               -- e.g. '중간고사 요약', '논문 정리', '진행상황 정리'
            created_at TEXT NOT NULL,
            FOREIGN KEY (subject_id) REFERENCES subjects (id) ON DELETE CASCADE
        );
        """
    )
    conn.commit()
    conn.close()


# ---------- subjects ----------

def list_subjects():
    conn = get_conn()
    rows = conn.execute("SELECT * FROM subjects ORDER BY name").fetchall()
    conn.close()
    return rows


def add_subject(name: str):
    conn = get_conn()
    conn.execute(
        "INSERT OR IGNORE INTO subjects (name, created_at) VALUES (?, ?)",
        (name.strip(), datetime.datetime.now().isoformat()),
    )
    conn.commit()
    conn.close()


def delete_subject(subject_id: int):
    conn = get_conn()
    conn.execute("DELETE FROM subjects WHERE id = ?", (subject_id,))
    conn.commit()
    conn.close()


# ---------- documents ----------

def add_document(category, subject_id, filename, file_blob, extracted_text, summary, summary_type):
    conn = get_conn()
    conn.execute(
        """INSERT INTO documents
           (category, subject_id, filename, file_blob, extracted_text, summary, summary_type, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            category,
            subject_id,
            filename,
            file_blob,
            extracted_text,
            summary,
            summary_type,
            datetime.datetime.now().isoformat(),
        ),
    )
    conn.commit()
    conn.close()


def list_documents(category, subject_id=None):
    conn = get_conn()
    if subject_id is not None:
        rows = conn.execute(
            """SELECT id, filename, summary, summary_type, created_at
               FROM documents WHERE category = ? AND subject_id = ?
               ORDER BY created_at DESC""",
            (category, subject_id),
        ).fetchall()
    else:
        rows = conn.execute(
            """SELECT id, filename, summary, summary_type, created_at
               FROM documents WHERE category = ?
               ORDER BY created_at DESC""",
            (category,),
        ).fetchall()
    conn.close()
    return rows


def get_document(doc_id: int):
    conn = get_conn()
    row = conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
    conn.close()
    return row


def delete_document(doc_id: int):
    conn = get_conn()
    conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
    conn.commit()
    conn.close()
