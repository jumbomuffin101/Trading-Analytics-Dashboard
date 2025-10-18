# backend/database.py
from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from typing import List, Dict, Iterable

DB_PATH = os.environ.get(
    "SSMIF_DB_PATH",
    os.path.join(os.path.dirname(__file__), "ssmif.db"),
)

@contextmanager
def connect():
    con = sqlite3.connect(DB_PATH)
    try:
        yield con
    finally:
        con.close()

def init_db() -> None:
    """Create tables if they don't exist."""
    with connect() as con:
        cur = con.cursor()
        cur.execute("""
        CREATE TABLE IF NOT EXISTS prices(
          symbol TEXT NOT NULL,
          d      TEXT NOT NULL, -- YYYY-MM-DD
          open   REAL,
          high   REAL,
          low    REAL,
          close  REAL NOT NULL,
          volume REAL,
          source TEXT DEFAULT 'yahoo',
          PRIMARY KEY(symbol, d)
        )
        """)
        cur.execute("""
        CREATE TABLE IF NOT EXISTS coverage(
          symbol TEXT NOT NULL,
          start  TEXT NOT NULL,
          end    TEXT NOT NULL
        )
        """)
        cur.execute("""
        CREATE TABLE IF NOT EXISTS backtests(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts TEXT NOT NULL,
          symbol TEXT NOT NULL,
          start TEXT NOT NULL,
          end   TEXT NOT NULL,
          params_json  TEXT NOT NULL,
          metrics_json TEXT NOT NULL
        )
        """)
        con.commit()

def upsert_prices(symbol: str, rows: Iterable[Dict], source: str = "yahoo") -> int:
    """Insert/replace a batch of OHLCV rows for symbol."""
    symbol = symbol.upper()
    rows = list(rows)
    if not rows:
        return 0
    with connect() as con:
        con.executemany(
            "INSERT OR REPLACE INTO prices(symbol,d,open,high,low,close,volume,source) VALUES(?,?,?,?,?,?,?,?)",
            [
                (
                    symbol,
                    r["date"],
                    r.get("open"),
                    r.get("high"),
                    r.get("low"),
                    r.get("close"),
                    r.get("volume"),
                    source,
                )
                for r in rows
            ],
        )
        con.commit()
        return con.total_changes

def read_prices(symbol: str, start: str, end: str) -> List[Dict]:
    """Read inclusive range [start, end] for symbol into list of dicts ordered by date."""
    with connect() as con:
        cur = con.cursor()
        cur.execute(
            "SELECT d, open, high, low, close, volume FROM prices "
            "WHERE symbol=? AND d BETWEEN ? AND ? ORDER BY d ASC",
            (symbol.upper(), start, end),
        )
        out: List[Dict] = []
        for d, o, h, l, c, v in cur.fetchall():
            out.append({"date": d, "open": o, "high": h, "low": l, "close": c, "volume": v})
        return out

def record_coverage(symbol: str, start: str, end: str) -> None:
    with connect() as con:
        con.execute("INSERT INTO coverage(symbol,start,end) VALUES(?,?,?)", (symbol.upper(), start, end))
        con.commit()
