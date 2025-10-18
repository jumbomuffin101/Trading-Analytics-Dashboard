# backend/ingester.py
from __future__ import annotations

import datetime as dt
import time
import io
from typing import Literal, Optional, Tuple

import numpy as np
import pandas as pd
import requests

try:
    import yfinance as yf  # keep around as a backup path
except Exception:
    yf = None  # type: ignore

# Shared session w/ realistic UA (helps reduce throttling)
_SESSION = requests.Session()
_SESSION.headers.update({
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0 Safari/537.36"
    )
})

# -------------------- utils --------------------
def _parse_date(s: str | dt.date | dt.datetime) -> dt.date:
    if isinstance(s, dt.date) and not isinstance(s, dt.datetime):
        return s
    return pd.to_datetime(s).date()

def _clean_df(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame()
    df = df.rename(columns={
        "Open": "open", "High": "high", "Low": "low",
        "Close": "close", "Adj Close": "adj_close", "Volume": "volume"
    })
    if "Date" in df.columns:
        df["Date"] = pd.to_datetime(df["Date"])
        df = df.set_index("Date")
    if not isinstance(df.index, pd.DatetimeIndex):
        df.index = pd.to_datetime(df.index)
    df.index = df.index.tz_localize(None)
    keep = [c for c in ["open","high","low","close","volume"] if c in df.columns]
    if not keep:
        return pd.DataFrame()
    df = df[keep].sort_index().dropna(how="any")
    return df

# -------------------- FAST Yahoo Chart API --------------------
def _fetch_from_yahoo_chart(symbol: str, start: dt.date, end: dt.date, retries: int = 4, backoff: float = 0.5
                           ) -> Tuple[pd.DataFrame, str]:
    """
    Hit Yahoo's v8 chart endpoint directly (fast). Returns (df, "yahoo-chart").
    """
    period1 = int(pd.Timestamp(start).tz_localize("UTC").timestamp())
    # Yahoo period2 is exclusive, add a day to include 'end'
    period2 = int(pd.Timestamp(end + dt.timedelta(days=1)).tz_localize("UTC").timestamp())

    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
    params = {
        "period1": period1,
        "period2": period2,
        "interval": "1d",
        "includeAdjustedClose": "true",
    }

    last_err: Optional[Exception] = None
    delay = backoff
    for _ in range(retries):
        try:
            r = _SESSION.get(url, params=params, timeout=15)
            if r.status_code == 429:
                last_err = RuntimeError("Yahoo rate limit (chart API)")
            elif r.status_code != 200:
                last_err = RuntimeError(f"Yahoo chart HTTP {r.status_code}")
            else:
                j = r.json()
                res = j.get("chart", {}).get("result")
                if not res:
                    last_err = RuntimeError("Yahoo chart: empty result")
                else:
                    result = res[0]
                    timestamps = result.get("timestamp", [])
                    indicators = result.get("indicators", {}).get("quote", [{}])[0]
                    if not timestamps or "close" not in indicators:
                        last_err = RuntimeError("Yahoo chart: missing fields")
                    else:
                        # build DataFrame
                        idx = pd.to_datetime(np.array(timestamps, dtype="int64"), unit="s", utc=True).tz_convert(None)
                        df = pd.DataFrame({
                            "open":  indicators.get("open"),
                            "high":  indicators.get("high"),
                            "low":   indicators.get("low"),
                            "close": indicators.get("close"),
                            "volume": indicators.get("volume"),
                        }, index=idx)
                        df = _clean_df(df)
                        if not df.empty:
                            return df, "yahoo"
        except Exception as e:
            last_err = e
        time.sleep(delay)
        delay *= 2

    raise RuntimeError(f"Yahoo chart API failed: {last_err}")

def _fetch_from_yfinance_download(symbol: str, start: dt.date, end: dt.date, retries: int = 3) -> Tuple[pd.DataFrame, str]:
    if yf is None:
        return pd.DataFrame(), "none"
    end_plus1 = end + dt.timedelta(days=1)
    delay = 0.6
    last_err: Optional[Exception] = None
    for _ in range(retries):
        try:
            df = yf.download(
                symbol,
                start=start.isoformat(),
                end=end_plus1.isoformat(),
                interval="1d",
                auto_adjust=True,
                progress=False,
                threads=False,
                session=_SESSION,
            )
            df = _clean_df(df)
            if not df.empty:
                return df, "yahoo"
        except Exception as e:
            last_err = e
        time.sleep(delay); delay *= 2
    return pd.DataFrame(), "none"

def _fetch_from_stooq(symbol: str, start: dt.date, end: dt.date) -> Tuple[pd.DataFrame, str]:
    sym = symbol.lower()
    if not sym.endswith(".us"):
        sym = f"{sym}.us"
    url = f"https://stooq.com/q/d/l/?s={sym}&i=d"
    r = _SESSION.get(url, timeout=20)
    if r.status_code != 200 or not r.text or "Date,Open,High,Low,Close,Volume" not in r.text:
        return pd.DataFrame(), "none"
    df = pd.read_csv(io.StringIO(r.text))
    df = _clean_df(df)
    if df.empty:
        return pd.DataFrame(), "none"
    mask = (df.index.date >= start) & (df.index.date <= end)
    return df.loc[mask], "stooq"

def fetch_prices(
    symbol: str,
    start: str | dt.date,
    end: str | dt.date,
    prefer: Literal["yahoo","auto"] = "yahoo",
    allow_fallback: bool = False
) -> Tuple[pd.DataFrame, str]:
    """
    Returns (df, source). source is one of {"yahoo", "stooq", "none"}.
    - prefer="yahoo": try Yahoo chart API (fast), then yfinance.download, then (optionally) stooq
    - allow_fallback controls whether to return stooq if Yahoo fails
    """
    start_d = _parse_date(start)
    end_d = _parse_date(end)
    if end_d < start_d:
        start_d, end_d = end_d, start_d

    # 1) Yahoo fast API
    try:
        df, src = _fetch_from_yahoo_chart(symbol, start_d, end_d)
        if not df.empty:
            return df, src
    except Exception:
        pass

    # 2) yfinance.download backup
    df, src = _fetch_from_yfinance_download(symbol, start_d, end_d)
    if not df.empty:
        return df, src

    # 3) optional stooq fallback
    if allow_fallback:
        df, src = _fetch_from_stooq(symbol, start_d, end_d)
        if not df.empty:
            return df, src

    # Nothing
    return pd.DataFrame(), "none"
