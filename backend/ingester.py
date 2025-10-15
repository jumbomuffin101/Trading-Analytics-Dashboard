from __future__ import annotations
import pandas as pd
from sqlalchemy import text
from .database import get_engine

def load_prices(symbol: str, start: str, end: str) -> pd.DataFrame:
    eng = get_engine()
    q = text(\"\"\"
        SELECT symbol, date, open, high, low, close, adj_close, volume
        FROM prices
        WHERE symbol=:s AND date>=:a AND date<=:b
        ORDER BY date ASC
    \"\"\")
    with eng.begin() as con:
        rows = con.execute(q, dict(s=symbol.upper(), a=start, b=end)).mappings().all()
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    # ensure pandas datetime for strategy
    df['date'] = pd.to_datetime(df['date'], errors='coerce')
    df = df.dropna(subset=['date'])
    return df
