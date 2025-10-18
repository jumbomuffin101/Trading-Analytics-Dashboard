# backend/main.py
from __future__ import annotations

from typing import Dict, Tuple, List, Any
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from ingester import fetch_prices
from backtest import run_backtest
from database import init_db, read_prices, upsert_prices

app = FastAPI(title="SSMIF Quant Backend")

# CORS for local Vite dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure DB tables exist
init_db()

# Simple in-memory cache: (symbol, start, end) -> (timestamp, df, source)
_PRICE_CACHE: Dict[Tuple[str, str, str], Tuple[float, pd.DataFrame, str]] = {}
_PRICE_TTL_SECONDS = 15 * 60  # 15 minutes


def _now_ts() -> float:
    return datetime.now(timezone.utc).timestamp()


def _df_from_rows(rows: List[Dict[str, Any]]) -> pd.DataFrame:
    """Convert DB rows -> DataFrame with DateTimeIndex."""
    if not rows:
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"])
    df = df.set_index("date").sort_index()
    return df


def _ensure_db_has_range(symbol: str, start: str, end: str) -> str:
    """
    Make sure DB has [start, end] for `symbol`.
    We fetch from Yahoo Finance (no fallback) and upsert into DB.
    Returns the source string used.
    """
    df, source = fetch_prices(symbol, start, end, prefer="yahoo", allow_fallback=False)
    if df.empty:
        raise HTTPException(
            status_code=429,
            detail="Yahoo Finance temporarily unavailable for this range.",
        )

    rows = []
    for ts, row in df.iterrows():
        rows.append(
            {
                "date": str(pd.to_datetime(ts).date()),
                "open": float(row.get("open", np.nan)) if "open" in row else None,
                "high": float(row.get("high", np.nan)) if "high" in row else None,
                "low": float(row.get("low", np.nan)) if "low" in row else None,
                "close": float(row["close"]),
                "volume": float(row.get("volume", np.nan)) if "volume" in row else None,
            }
        )

    # Persist with explicit source
    upsert_prices(symbol, rows, "Yahoo Finance")
    return "Yahoo Finance"


def _get_prices_cached(symbol: str, start: str, end: str) -> Tuple[pd.DataFrame, str]:
    """Fetch from cache/DB; if DB missing, ingest from Yahoo then read."""
    key = (symbol.upper(), start, end)
    now = _now_ts()

    if key in _PRICE_CACHE:
        ts, df, src = _PRICE_CACHE[key]
        if now - ts <= _PRICE_TTL_SECONDS:
            return df.copy(), src

    src = _ensure_db_has_range(symbol, start, end)
    rows = read_prices(symbol, start, end)
    if not rows:
        raise HTTPException(status_code=404, detail="No data in DB after ingest.")
    df = _df_from_rows(rows)

    _PRICE_CACHE[key] = (now, df.copy(), src)
    return df, src


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/peek")
async def peek_post(req: Request):
    data = await req.json()
    symbol = data.get("symbol")
    start = data.get("start")
    end = data.get("end")
    if not (symbol and start and end):
        raise HTTPException(status_code=400, detail="symbol, start, end are required")

    df, _src = _get_prices_cached(symbol, start, end)
    if "close" not in df.columns or df["close"].empty:
        raise HTTPException(status_code=404, detail="No closes in range.")

    closes = df["close"].astype(float).to_numpy()
    min_close = float(np.min(closes))
    median_close = float(np.median(closes))
    max_close = float(np.max(closes))
    suggested_threshold = float(np.percentile(closes, 75))

    tail = df.tail(40).copy()
    preview: List[Dict[str, Any]] = []
    for ts, row in tail.iterrows():
        preview.append(
            {
                "date": pd.to_datetime(ts).strftime("%Y-%m-%d"),
                "open": float(row.get("open", np.nan)) if "open" in row else None,
                "high": float(row.get("high", np.nan)) if "high" in row else None,
                "low": float(row.get("low", np.nan)) if "low" in row else None,
                "close": float(row["close"]),
            }
        )

    return {
        "symbol": symbol.upper(),
        "start": start,
        "end": end,
        "min_close": round(min_close, 4),
        "median_close": round(median_close, 4),
        "max_close": round(max_close, 4),
        "suggested_threshold": round(suggested_threshold, 4),
        "rows": int(len(df)),
        "preview": preview,
        "source": "Yahoo Finance",
    }


@app.post("/backtest")
async def backtest_post(req: Request):
    data = await req.json()
    symbol = data.get("symbol")
    start = data.get("start")
    end = data.get("end")
    threshold = data.get("threshold")
    hold_days = data.get("hold_days")

    if not (symbol and start and end):
        raise HTTPException(status_code=400, detail="symbol, start, end are required")
    if threshold is None or not isinstance(threshold, (int, float)):
        raise HTTPException(status_code=400, detail="threshold must be a number")
    if hold_days is None or not isinstance(hold_days, int) or hold_days < 1:
        raise HTTPException(status_code=400, detail="hold_days must be an integer >= 1")

    # Ensure data present (and cached)
    df, _src = _get_prices_cached(symbol, start, end)
    if "close" not in df.columns or df["close"].empty:
        raise HTTPException(status_code=404, detail="No closes in range.")

    # ---------- Dynamic initial equity rule ----------
    # Default $5,000 for most symbols; if the median close in-range is > $5,000,
    # bump to $50,000 so we can meaningfully trade high-priced assets.
    median_close = float(df["close"].median())
    initial_equity = 5_000.0 if median_close <= 5_000.0 else 50_000.0

    # Run the strategy
    result = run_backtest(
        df,
        threshold=float(threshold),
        hold_days=int(hold_days),
        initial_equity=initial_equity,
    )

    # ---- Trades payload
    trades_list = result.get("trades", [])
    trades_payload = [
        {
            "entry_date": t.entry_date if hasattr(t, "entry_date") else t.get("entry_date"),
            "entry_price": float(t.entry_price if hasattr(t, "entry_price") else t.get("entry_price")),
            "exit_date": t.exit_date if hasattr(t, "exit_date") else t.get("exit_date"),
            "exit_price": float(t.exit_price if hasattr(t, "exit_price") else t.get("exit_price")),
            "pnl": float(t.pnl if hasattr(t, "pnl") else t.get("pnl")),
            "return_pct": float(t.return_pct if hasattr(t, "return_pct") else t.get("return_pct")),
        }
        for t in trades_list
    ]

    # ---- Equity curve payload
    equity_curve_payload: List[Dict[str, Any]] = []
    eq_df = result.get("equity_df")
    if isinstance(eq_df, pd.DataFrame) and not eq_df.empty:
        for _, row in eq_df.iterrows():
            equity_curve_payload.append(
                {"date": str(row["date"]), "equity": float(row["equity"])}
            )

    # ---- Price series payload (for the "Price" chart)
    price_series_payload = [
        {"date": pd.to_datetime(ts).strftime("%Y-%m-%d"), "close": float(row["close"])}
        for ts, row in df.iterrows()
    ]

    # ---- Metrics
    # Some versions of run_backtest may not compute these; guard and compute here if missing.
    total_pnl = float(result.get("total_pnl", 0.0))
    win_rate = float(result.get("win_rate", 0.0))
    ann_return = float(result.get("ann_return", 0.0))
    max_dd = float(result.get("max_drawdown", 0.0))
    final_equity = float(result.get("final_equity", initial_equity))

    # Optional extras
    trade_count = int(result.get("trade_count", len(trades_payload)))
    if "avg_trade_return" in result:
        avg_trade_return = float(result["avg_trade_return"])
    else:
        avg_trade_return = (
            sum(t["return_pct"] for t in trades_payload) / trade_count if trade_count else 0.0
        )

    metrics = {
        "total_pnl": total_pnl,
        "win_rate": win_rate,
        "annualized_return": ann_return,
        "max_drawdown": max_dd,
        "final_equity": final_equity,
        "initial_equity": float(initial_equity),  # reflect dynamic equity
        "avg_trade_return": avg_trade_return,
        "trade_count": trade_count,
    }

    return {
        "symbol": symbol.upper(),
        "start": start,
        "end": end,
        "params": {"threshold": float(threshold), "hold_days": int(hold_days)},
        "metrics": metrics,
        "trades": trades_payload,
        "equity_curve": equity_curve_payload,
        "price_series": price_series_payload,
        "source": "Yahoo Finance",
    }
