from __future__ import annotations
from datetime import datetime, timedelta
from typing import Iterable
import pandas as pd
import yfinance as yf
from sqlalchemy import text
from .database import get_engine

def _date(s: str | datetime) -> str:
    if isinstance(s, datetime):
        return s.date().isoformat()
    return str(s)

def fetch_yf(symbol: str, start: str, end: str) -> pd.DataFrame:
    # yfinance end is exclusive; add one day to include end date
    end_inclusive = (pd.Timestamp(end) + pd.Timedelta(days=1)).date().isoformat()
    df = yf.download(symbol, start=start, end=end_inclusive, progress=False, auto_adjust=False)
    if df.empty:
        return df
    df = df.rename(columns={
        "Open":"open","High":"high","Low":"low",
        "Close":"close","Adj Close":"adj_close","Volume":"volume"
    }).reset_index(names="date")
    # normalize types
    df["symbol"] = symbol.upper()
    df["date"] = pd.to_datetime(df["date"]).dt.date.astype(str)
    return df[["symbol","date","open","high","low","close","adj_close","volume"]]

def upsert_prices(rows: pd.DataFrame) -> int:
    if rows.empty:
        return 0
    eng = get_engine()
    sql = text("""
        INSERT INTO prices(symbol,date,open,high,low,close,adj_close,volume)
        VALUES(:symbol,:date,:open,:high,:low,:close,:adj_close,:volume)
        ON CONFLICT(symbol,date) DO UPDATE SET
          open=excluded.open,
          high=excluded.high,
          low=excluded.low,
          close=excluded.close,
          adj_close=excluded.adj_close,
          volume=excluded.volume;
    """)
    with eng.begin() as con:
        con.execute(sql, rows.to_dict(orient="records"))
    return len(rows)

def existing_dates(symbol: str, start: str, end: str) -> set[str]:
    eng = get_engine()
    q = text("""SELECT date FROM prices WHERE symbol=:s AND date BETWEEN :a AND :b""")
    with eng.begin() as con:
        res = con.execute(q, dict(s=symbol.upper(), a=start, b=end)).scalars().all()
    return set(res)

def ensure_data(symbol: str, start: str, end: str) -> int:
    # fetch only missing days (weekends/holidays are okay; yf returns business days)
    # Strategy: we simply fetch full range, then upsert.
    df = fetch_yf(symbol, start, end)
    return upsert_prices(df)

def load_prices(symbol: str, start: str, end: str) -> pd.DataFrame:
    eng = get_engine()
    q = text("""
        SELECT date, open, high, low, close, adj_close, volume
        FROM prices
        WHERE symbol=:s AND date BETWEEN :a AND :b
        ORDER BY date ASC
    """)
    with eng.begin() as con:
        rows = con.execute(q, dict(s=symbol.upper(), a=start, b=end)).mappings().all()
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"])
    return df
