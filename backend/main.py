from fastapi import HTTPException, Request
import numpy as np
import pandas as pd
from typing import Dict, Any, List

from backtest import (
    run_backtest,
    run_backtest_stacking,
    breakout_entries,              # cross-only
    breakout_entries_everybar,     # <<< every bar >= threshold
    sma_entries,                   # cross-only
    sma_entries_everybar,          # <<< every bar fast >= slow
    meanrev_entries,               # z-score variant (optional)
    meanrev_drop_entries,          # drop-% variant (UI-friendly)
)

@app.post("/backtest")
async def backtest_post(req: Request):
    data = await req.json()
    params = data.get("params", {}) or {}

    symbol = data.get("symbol")
    start  = data.get("start")
    end    = data.get("end")

    # Accept frontend aliases
    raw_strategy = (data.get("strategy") or "breakout").lower().strip()
    if raw_strategy in ("sma_cross", "sma-x", "sma"):
        strategy = "sma"
    elif raw_strategy in ("mean_rev", "mean-rev", "mean_reversion", "mean-reversion"):
        strategy = "mean_reversion"
    else:
        strategy = "breakout"

    # Entry mode: "every_bar" (default) or "cross"
    entry_mode = (data.get("entry_mode") or data.get("mode") or "every_bar").lower().strip()

    # Core params (allow both top-level and params)
    hold_days = data.get("hold_days", params.get("hold_days"))
    threshold = data.get("threshold", params.get("threshold"))
    stacking  = bool(data.get("stacking", True))        # keep stacking ON
    position_size = float(data.get("position_size", 1.0))

    if not (symbol and start and end):
        raise HTTPException(status_code=400, detail="symbol, start, end are required")
    try:
        hold_days = int(hold_days)
    except Exception:
        raise HTTPException(status_code=400, detail="hold_days must be an integer >= 1")
    if hold_days < 1:
        raise HTTPException(status_code=400, detail="hold_days must be an integer >= 1")

    # Load data
    df, _src = _get_prices_cached(symbol, start, end)
    if "close" not in df.columns or df["close"].empty:
        raise HTTPException(status_code=404, detail="No closes in range.")
    df = df.sort_index()

    # Dynamic initial equity
    median_close = float(pd.to_numeric(df["close"], errors="coerce").astype(float).median())
    initial_equity = 5_000.0 if median_close <= 5_000.0 else 50_000.0

    # ----------------- Strategy routing -----------------
    params_payload: Dict[str, Any] = {"hold_days": int(hold_days), "entry_mode": entry_mode}

    if strategy == "breakout":
        # If missing, choose lively threshold (~75th pct of closes)
        if threshold is None or not isinstance(threshold, (int, float)):
            closes = pd.to_numeric(df["close"], errors="coerce").astype(float).to_numpy()
            threshold = float(np.nanpercentile(closes, 75))
        params_payload["threshold"] = float(threshold)

        # entries: every-bar by default
        if entry_mode == "cross":
            entries = breakout_entries(df, float(threshold))
        else:
            entries = breakout_entries_everybar(df, float(threshold))

        result = run_backtest_stacking(df, entries, hold_days, initial_equity, position_size)

    elif strategy == "sma":
        fast = data.get("fast", params.get("fast"))
        slow = data.get("slow", params.get("slow"))
        try:
            fast = int(fast) if fast is not None else 10
            slow = int(slow) if slow is not None else 20
        except Exception:
            fast, slow = 10, 20
        if fast >= slow:
            fast, slow = max(5, min(fast, slow) - 5), max(fast, slow)
        params_payload.update({"fast": fast, "slow": slow})

        # entries: every-bar by default
        if entry_mode == "cross":
            entries = sma_entries(df, fast, slow)
        else:
            entries = sma_entries_everybar(df, fast, slow)

        result = run_backtest_stacking(df, entries, hold_days, initial_equity, position_size)

    elif strategy == "mean_reversion":
        # Support drop-% (preferred by your UI) and z-score fallback
        drop_pct = data.get("drop_pct", params.get("drop_pct"))
        lookback = data.get("lookback", params.get("lookback"))
        k_sigma  = data.get("k_sigma", params.get("k_sigma"))

        if isinstance(drop_pct, (int, float)):
            drop_pct = float(drop_pct)
            if drop_pct <= 0:
                drop_pct = 1.0
            params_payload.update({"drop_pct": drop_pct})
            entries = meanrev_drop_entries(df, drop_pct)  # every oversold bar
        else:
            try:
                lookback = int(lookback) if lookback is not None else 20
            except Exception:
                lookback = 20
            k_sigma = float(k_sigma) if isinstance(k_sigma, (int, float)) else 1.0
            params_payload.update({"lookback": lookback, "k_sigma": k_sigma})
            entries = meanrev_entries(df, lookback, k_sigma)  # you can also make a z-score_everybar if desired

        result = run_backtest_stacking(df, entries, hold_days, initial_equity, position_size)

    else:
        raise HTTPException(status_code=400, detail="Unknown strategy")

    # ------------- Shape response (unchanged) -------------
    trades_list = result.get("trades", [])
    trades_payload = [
        {
            "entry_date": getattr(t, "entry_date", t.get("entry_date")),
            "entry_price": float(getattr(t, "entry_price", t.get("entry_price"))),
            "exit_date": getattr(t, "exit_date", t.get("exit_date")),
            "exit_price": float(getattr(t, "exit_price", t.get("exit_price"))),
            "pnl": float(getattr(t, "pnl", t.get("pnl"))),
            "return_pct": float(getattr(t, "return_pct", t.get("return_pct"))),
        }
        for t in trades_list
    ]

    equity_curve_payload: List[Dict[str, Any]] = []
    eq_df = result.get("equity_df")
    if isinstance(eq_df, pd.DataFrame) and not eq_df.empty:
        for _, row in eq_df.iterrows():
            equity_curve_payload.append({"date": str(row["date"]), "equity": float(row["equity"])})

    price_series_payload = [
        {"date": pd.to_datetime(ts).strftime("%Y-%m-%d"), "close": float(row["close"])}
        for ts, row in df.iterrows()
    ]

    total_pnl = float(result.get("total_pnl", 0.0))
    win_rate = float(result.get("win_rate", 0.0))
    ann_return = float(result.get("ann_return", 0.0))
    max_dd = float(result.get("max_drawdown", 0.0))
    final_equity = float(result.get("final_equity", initial_equity))
    trade_count = int(result.get("trade_count", len(trades_payload)))
    avg_trade_return = float(
        result.get("avg_trade_return",
                   (sum(t["return_pct"] for t in trades_payload) / trade_count) if trade_count else 0.0)
    )

    debug = result.get("debug", {})
    metrics = {
        "total_pnl": total_pnl,
        "win_rate": win_rate,
        "annualized_return": ann_return,
        "max_drawdown": max_dd,
        "final_equity": final_equity,
        "initial_equity": float(initial_equity),
        "avg_trade_return": avg_trade_return,
        "trade_count": trade_count,
        "signals_total": int(debug.get("signals_total", 0)),
        "signals_kept": int(debug.get("signals_kept", 0)),
    }

    return {
        "symbol": symbol.upper(),
        "start": start,
        "end": end,
        "strategy": strategy,
        "params": { **params_payload, "stacking": bool(stacking), "position_size": float(position_size) },
        "metrics": metrics,
        "trades": trades_payload,
        "equity_curve": equity_curve_payload,
        "price_series": price_series_payload,
        "source": "Yahoo Finance",
    }
