from __future__ import annotations
from datetime import datetime
from typing import Iterable
import pandas as pd
import yfinance as yf
from sqlalchemy import text
from .database import get_engine

def fetch_yf(symbol: str, start: str, end: str) -> pd.DataFrame:
    end_inclusive = (pd.Timestamp(end) + pd.Timedelta(days=1)).date().isoformat()
    df = yf.download(symbol, start=start, end=end_inclusive, progress=False, auto_adjust=False)
    if df.empty:
        return df
    df = df.rename(columns={
        'Open': 'open',
        'High': 'high',
        'Low': 'low',
        'Close': 'close',
        'Adj Close': 'adj_close',
        'Volume': 'volume'
    }).reset_index(names='date')
    df['symbol'] = symbol.upper()
    df['date'] = pd.to_datetime(df['date']).dt.date.astype(str)
    return df[['symbol', 'date', 'open', 'high', 'low', 'close', 'adj_close', 'volume']]

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
    records = [
        {
            "symbol": str(r["symbol"]),
            "date": str(r["date"]),
            "open": float(r["open"]),
            "high": float(r["high"]),
            "low": float(r["low"]),
            "close": float(r["close"]),
            "adj_close": float(r["adj_close"]),
            "volume": int(r["volume"]) if not pd.isna(r["volume"]) else 0
        }
        for _, r in rows.iterrows()
    ]
    with eng.begin() as con:
        con.execute(sql, records)
    return len(records)

def ensure_data(symbol: str, start: str, end: str) -> int:
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
