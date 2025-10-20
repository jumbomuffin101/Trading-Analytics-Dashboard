# ... keep the rest of your file the same (imports etc.)
from backtest import (
    run_backtest,
    run_backtest_stacking,
    breakout_entries,
    sma_entries,
    meanrev_entries,
)

# ...

@app.post("/backtest")
async def backtest_post(req: Request):
    data = await req.json()
    symbol = data.get("symbol")
    start = data.get("start")
    end = data.get("end")

    # core params
    strategy = (data.get("strategy") or "breakout").lower()
    hold_days = data.get("hold_days")
    stacking = bool(data.get("stacking", True))   # default ON
    position_size = float(data.get("position_size", 1.0))

    # per-strategy params (with safe defaults to avoid "1 trade" symptom)
    threshold = data.get("threshold")
    fast = data.get("fast")
    slow = data.get("slow")
    lookback = data.get("lookback")
    k_sigma = data.get("k_sigma")

    if not (symbol and start and end):
        raise HTTPException(status_code=400, detail="symbol, start, end are required")
    if hold_days is None or not isinstance(hold_days, int) or hold_days < 1:
        raise HTTPException(status_code=400, detail="hold_days must be an integer >= 1")

    # Load data
    df, _src = _get_prices_cached(symbol, start, end)
    if "close" not in df.columns or df["close"].empty:
        raise HTTPException(status_code=404, detail="No closes in range.")
    df = df.sort_index()

    # Dynamic initial equity
    median_close = float(pd.to_numeric(df["close"], errors="coerce").astype(float).median())
    initial_equity = 5_000.0 if median_close <= 5_000.0 else 50_000.0

    # ---- Build entries per strategy (defaults ensure LOTS of signals) ----
    params_payload: Dict[str, Any] = {"hold_days": int(hold_days)}

    if strategy == "breakout":
        if threshold is None or not isinstance(threshold, (int, float)):
            # auto: use 75th percentile like peek (gives several crosses in 5y SPY)
            closes = pd.to_numeric(df["close"], errors="coerce").astype(float)
            threshold = float(np.nanpercentile(closes.to_numpy(), 75))
        params_payload["threshold"] = float(threshold)

        if stacking:
            entries = breakout_entries(df, float(threshold))
            result = run_backtest_stacking(
                df, entries, int(hold_days), initial_equity=initial_equity, position_size=position_size
            )
        else:
            result = run_backtest(df, float(threshold), int(hold_days), initial_equity)

    elif strategy == "sma":
        # defaults chosen to guarantee ~dozens of crosses in 5y on daily data
        if not (isinstance(fast, int) and fast > 0):
            fast = 10
        if not (isinstance(slow, int) and slow > 0):
            slow = 20
        if not (fast < slow):
            fast, slow = min(fast, slow), max(fast, slow)
            if fast == slow:
                fast = max(5, slow - 5)
        params_payload.update({"fast": int(fast), "slow": int(slow)})

        entries = sma_entries(df, int(fast), int(slow))
        result = run_backtest_stacking(
            df, entries, int(hold_days), initial_equity=initial_equity, position_size=position_size
        )

    elif strategy in ("meanrev", "mean_reversion", "mean-reversion"):
        if not (isinstance(lookback, int) and lookback > 1):
            lookback = 20
        if not isinstance(k_sigma, (int, float)):
            k_sigma = 1.0  # many signals
        params_payload.update({"lookback": int(lookback), "k_sigma": float(k_sigma)})

        entries = meanrev_entries(df, int(lookback), float(k_sigma), every_bar=True)
        result = run_backtest_stacking(
            df, entries, int(hold_days), initial_equity=initial_equity, position_size=position_size
        )
        strategy = "mean_reversion"

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
            equity_curve_payload.append({"date": str(row["date"]), "equity": float(row["equity"])})

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
        avg_trade_return = (sum(t["return_pct"] for t in trades_payload) / trade_count) if trade_count else 0.0

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
