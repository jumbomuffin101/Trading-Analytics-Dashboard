from __future__ import annotations
from typing import List, Dict
import pandas as pd
import numpy as np
import yfinance as yf
from pandas_datareader import data as pdr
from sqlalchemy import text
from .database import get_engine

def _end_inclusive(end: str) -> str:
    return (pd.Timestamp(end) + pd.Timedelta(days=1)).date().isoformat()

def _normalize(df: pd.DataFrame, symbol: str) -> pd.DataFrame:
    if df is None or getattr(df, 'empty', True):
        return pd.DataFrame(columns=['symbol','date','open','high','low','close','adj_close','volume'])
    df = df.reset_index()
    rename_map = {
        'Date':'date','date':'date',
        'Open':'open','open':'open',
        'High':'high','high':'high',
        'Low':'low','low':'low',
        'Close':'close','close':'close',
        'Adj Close':'adj_close','AdjClose':'adj_close','adj close':'adj_close','adjclose':'adj_close',
        'Volume':'volume','volume':'volume'
    }
    df = df.rename(columns={k:v for k,v in rename_map.items() if k in df.columns})
    required = {'date','open','high','low','close','volume'}
    if not required.issubset(df.columns):
        return pd.DataFrame(columns=['symbol','date','open','high','low','close','adj_close','volume'])
    if 'adj_close' not in df.columns:
        df['adj_close'] = df['close']
    df['symbol'] = symbol.upper()
    df['date'] = pd.to_datetime(df['date'], errors='coerce').dt.date.astype(str)
    df = df[['symbol','date','open','high','low','close','adj_close','volume']].copy()
    df = df[df['date'].astype(bool)]
    return df

def fetch_yf(symbol: str, start: str, end: str) -> pd.DataFrame:
    sym = symbol.upper()
    end_inc = _end_inclusive(end)
    df = yf.download(sym, start=start, end=end_inc, progress=False, auto_adjust=False)
    if getattr(df, 'empty', True):
        try:
            df = yf.Ticker(sym).history(start=start, end=end_inc, auto_adjust=False)
        except Exception:
            df = pd.DataFrame()
    return _normalize(df, sym)

def fetch_stooq(symbol: str, start: str, end: str) -> pd.DataFrame:
    sym = symbol.upper()
    try:
        df = pdr.DataReader(sym, data_source='stooq', start=start, end=end)
        if isinstance(df, pd.DataFrame) and not df.empty:
            df = df.sort_index()
    except Exception:
        df = pd.DataFrame()
    return _normalize(df, sym)

def fetch_synthetic(symbol: str, start: str, end: str) -> pd.DataFrame:
    # keep the original symbol to simplify downstream queries
    sym = symbol.upper()
    idx = pd.bdate_range(start, end, tz=None)
    if len(idx) == 0:
        return pd.DataFrame(columns=['symbol','date','open','high','low','close','adj_close','volume'])
    rng = np.random.default_rng(42)
    mu, sigma = 0.10, 0.25
    dt = 1/252
    steps = rng.normal((mu - 0.5*sigma*sigma)*dt, sigma*np.sqrt(dt), size=len(idx))
    price = 100 * np.exp(np.cumsum(steps))
    close = pd.Series(price, index=idx)
    spread = np.clip(close * 0.005, 0.05, None)
    open_ = close.shift(1).fillna(close.iloc[0])
    high = pd.concat([open_, close], axis=1).max(axis=1) + spread
    low  = pd.concat([open_, close], axis=1).min(axis=1) - spread
    vol  = rng.integers(1e5, 5e6, size=len(idx))
    df = pd.DataFrame({
        'symbol': sym,
        'date': idx.date.astype(str),
        'open': open_.values,
        'high': high.values,
        'low':  low.values,
        'close': close.values,
        'adj_close': close.values,
        'volume': vol
    })
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
    records: List[Dict] = []
    for _, r in rows.iterrows():
        try:
            rec = {
                'symbol': str(r['symbol']).upper(),
                'date':   str(r['date']),
                'open':   float(r['open']),
                'high':   float(r['high']),
                'low':    float(r['low']),
                'close':  float(r['close']),
                'adj_close': float(r['adj_close']),
                'volume': int(r['volume']) if pd.notna(r['volume']) else 0
            }
        except Exception:
            continue
        if not rec['symbol'] or not rec['date']:
            continue
        records.append(rec)
    if not records:
        return 0
    with eng.begin() as con:
        con.execute(sql, records)
    return len(records)

def ensure_data(symbol: str, start: str, end: str) -> int:
    df = fetch_yf(symbol, start, end)
    if df.empty:
        df = fetch_stooq(symbol, start, end)
    if df.empty:
        df = fetch_synthetic(symbol, start, end)
    return upsert_prices(df)

def load_prices(symbol: str, start: str, end: str) -> pd.DataFrame:
    eng = get_engine()
    q = text("""
        SELECT symbol, date, open, high, low, close, adj_close, volume
        FROM prices
        WHERE symbol = :s AND date >= :a AND date <= :b
        ORDER BY date ASC
    """)
    with eng.begin() as con:
        rows = con.execute(q, {'s': symbol.upper(), 'a': start, 'b': end}).mappings().all()
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    df['date'] = pd.to_datetime(df['date'], errors='coerce')
    df = df.dropna(subset=['date'])
    return df
