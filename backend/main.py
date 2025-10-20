# backend/main.py
from __future__ import annotations

from typing import Dict, Tuple, List, Any
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from ingester import fetch_prices
from backtest import (
    run_backtest,
    run_backtest_stacking,
    breakout_entries,
    sma_entries,
    meanrev_entries,
)
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

    # strategy & params
    strategy = (data.get("strategy") or "breakout").lower()
    hold_days = data.get("hold_days")
    stacking = bool(data.get("stacking", True))
    position_size = float(data.get("position_size", 1.0))

    # per-strategy params
    threshold = data.get("threshold")           # breakout
    fast = data.get("fast")                     # sma
    slow = data.get("slow")
    lookback = data.get("lookback")             # mean reversion
    k_sigma = data.get("k_sigma")

    if not (symbol and start and end):
        raise HTTPException(status_code=400, detail="symbol, start, end are required")
    if hold_days is None or not isinstance(hold_days, int) or hold_days < 1:
        raise HTTPException(status_code=400, detail="hold_days must be an integer >= 1")

    # Ensure data present (and cached)
    df, _src = _get_prices_cached(symbol, start, end)
    if "close" not in df.columns or df["close"].empty:
        raise HTTPException(status_code=404, detail="No closes in range.")

    # Dynamic initial equity
    median_close = float(df["close"].median())
    initial_equity = 5_000.0 if median_close <= 5_000.0 else 50_000.0

    # Build entries and run
    if strategy == "breakout":
        if threshold is None or not isinstance(threshold, (int, float)):
            raise HTTPException(status_code=400, detail="threshold must be a number for breakout")
        if stacking:
            entries = breakout_entries(df, float(threshold))
            result = run_backtest_stacking(
                df, entries, int(hold_days), initial_equity=initial_equity, position_size=position_size
            )
        else:
            # legacy single-position
            result = run_backtest(
                df, threshold=float(threshold), hold_days=int(hold_days), initial_equity=initial_equity
            )

        params_payload = {"threshold": float(threshold), "hold_days": int(hold_days)}

    elif strategy == "sma":
        if not (isinstance(fast, int) and isinstance(slow, int) and fast > 0 and slow > 0 and fast < slow):
            raise HTTPException(status_code=400, detail="sma needs fast<int>, slow<int>, and fast < slow")
        entries = sma_entries(df, int(fast), int(slow))
        result = run_backtest_stacking(
            df, entries, int(hold_days), initial_equity=initial_equity, position_size=position_size
        )
        params_payload = {"fast": int(fast), "slow": int(slow), "hold_days": int(hold_days)}

    elif strategy in ("meanrev", "mean_reversion", "mean-reversion"):
        if not (isinstance(lookback, int) and lookback > 1 and isinstance(k_sigma, (int, float))):
            raise HTTPException(status_code=400, detail="mean_reversion needs lookback<int> and k_sigma<number>")
        entries = meanrev_entries(df, int(lookback), float(k_sigma))
        result = run_backtest_stacking(
            df, entries, int(hold_days), initial_equity=initial_equity, position_size=position_size
        )
        params_payload = {"lookback": int(lookback), "k_sigma": float(k_sigma), "hold_days": int(hold_days)}
        strategy = "mean_reversion"  # normalize

    else:
        raise HTTPException(status_code=400, detail="Unknown strategy. Use breakout | sma | mean_reversion")

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

    # ---- Price series payload
    price_series_payload = [
        {"date": pd.to_datetime(ts).strftime("%Y-%m-%d"), "close": float(row["close"])}
        for ts, row in df.iterrows()
    ]

    # ---- Metrics
    total_pnl = float(result.get("total_pnl", 0.0))
    win_rate = float(result.get("win_rate", 0.0))
    ann_return = float(result.get("ann_return", 0.0))
    max_dd = float(result.get("max_drawdown", 0.0))
    final_equity = float(result.get("final_equity", initial_equity))
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
        "initial_equity": float(initial_equity),
        "avg_trade_return": avg_trade_return,
        "trade_count": trade_count,
    }

    return {
        "symbol": symbol.upper(),
        "start": start,
        "end": end,
        "strategy": strategy,
        "params": {
            **params_payload,
            "stacking": bool(stacking),
            "position_size": float(position_size),
        },
        "metrics": metrics,
        "trades": trades_payload,
        "equity_curve": equity_curve_payload,
        "price_series": price_series_payload,
        "source": "Yahoo Finance",
    }
