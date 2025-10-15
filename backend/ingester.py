from __future__ import annotations
from datetime import datetime
from typing import Iterable
import pandas as pd
import yfinance as yf
from sqlalchemy import text
from .database import get_engine

def fetch_yf(symbol: str, start: str, end: str) -> pd.DataFrame:
    # yfinance 'end' is exclusive; add one day to include end date
    end_inclusive = (pd.Timestamp(end) + pd.Timedelta(days=1)).date().isoformat()
    df = yf.download(
        symbol,
        start=start,
        end=end_inclusive,
        progress=False,
        auto_adjust=False
    )

    # Ensure DataFrame with expected columns
    if isinstance(df, pd.Series) or df is None or getattr(df, 'empty', True):
        return pd.DataFrame(columns=['symbol','date','open','high','low','close','adj_close','volume'])

    # Move index to column and normalize names
    df = df.reset_index()  # creates 'Date' column
    # Some yfinance versions return lowercase/uppercase variants; handle both
    rename_map = {
        'Date': 'date', 'date': 'date',
        'Open': 'open', 'open': 'open',
        'High': 'high', 'high': 'high',
        'Low': 'low',  'low':  'low',
        'Close': 'close', 'close': 'close',
        'Adj Close': 'adj_close', 'adjclose': 'adj_close', 'adj close': 'adj_close', 'AdjClose': 'adj_close',
        'Volume': 'volume', 'volume': 'volume'
    }
    df = df.rename(columns={k:v for k,v in rename_map.items() if k in df.columns})

    # If any required columns are missing, return empty to avoid weird states
    required = {'date','open','high','low','close','adj_close','volume'}
    if not required.issubset(set(df.columns)):
        return pd.DataFrame(columns=['symbol','date','open','high','low','close','adj_close','volume'])

    df['symbol'] = symbol.upper()
    df['date'] = pd.to_datetime(df['date'], errors='coerce').dt.date.astype(str)

    # Keep only expected columns/order
    df = df[['symbol','date','open','high','low','close','adj_close','volume']].copy()
    # Drop any rows with missing date
    df = df[df['date'].astype(bool)]
    return df

def upsert_prices(rows: pd.DataFrame) -> int:
    if rows is None or rows.empty:
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
    # Build explicit dicts for stable param binding
    records = []
    for _, r in rows.iterrows():
        try:
            rec = {
                "symbol": str(r.get("symbol", "")).upper(),
                "date":   str(r.get("date", "")),
                "open":   float(r.get("open", float('nan'))),
                "high":   float(r.get("high", float('nan'))),
                "low":    float(r.get("low", float('nan'))),
                "close":  float(r.get("close", float('nan'))),
                "adj_close": float(r.get("adj_close", float('nan'))),
                "volume": int(r.get("volume", 0)) if pd.notna(r.get("volume", 0)) else 0
            }
        except Exception:
            # Skip malformed rows
            continue
        # Require symbol and date
        if not rec["symbol"] or not rec["date"]:
            continue
        records.append(rec)

    if not records:
        return 0

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
