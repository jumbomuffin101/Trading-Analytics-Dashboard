# backend/backtest.py
from __future__ import annotations
from dataclasses import dataclass, asdict
from typing import List, Dict, Any
import pandas as pd
import numpy as np

@dataclass
class Trade:
    entry_date: str
    entry_price: float
    exit_date: str
    exit_price: float
    pnl: float
    return_pct: float

def run_backtest(
    df: pd.DataFrame,               # expects ['open','high','low','close'] and DatetimeIndex
    threshold: float,
    hold_days: int,
    initial_equity: float = 100_000.0,
) -> Dict[str, Any]:
    """
    UPDATED STRATEGY (more trades):
      - Enter while FLAT on any day the close >= threshold (no cross requirement).
      - Hold for N business days, one position at a time (1 share per trade).
      - Exit strictly after N bars; allow immediate re-entry next signal.
    Equity:
      - Starts at initial_equity
      - Adds raw PnL (exit_px - entry_px) on exit dates
      - Carried forward daily across the entire span (business days)
    """
    if df.empty:
        return {
            "trades": [],
            "equity_df": pd.DataFrame({"date": [], "equity": []}),
            "total_pnl": 0.0,
            "win_rate": 0.0,
            "ann_return": 0.0,
            "max_drawdown": 0.0,
            "final_equity": initial_equity,
            "initial_equity": initial_equity,
            "avg_trade_return": 0.0,
            "trade_count": 0,
        }

    df = df.copy().sort_index()
    df["date"] = df.index.strftime("%Y-%m-%d")

    # --------- CHANGE: "any touch/above" instead of cross-up ----------
    df["signal"] = df["close"] >= float(threshold)
    # ------------------------------------------------------------------

    dates  = df["date"].tolist()
    closes = df["close"].astype(float).tolist()

    trades: List[Trade] = []
    i = 0
    n = len(df)

    # One position at a time; while flat, enter whenever signal is true
    while i < n:
        if bool(df["signal"].iloc[i]):
            entry_idx = i
            exit_idx  = min(i + hold_days, n - 1)   # strict fixed-horizon exit
            entry_px  = float(closes[entry_idx])
            exit_px   = float(closes[exit_idx])
            pnl       = exit_px - entry_px
            ret       = (pnl / entry_px) if entry_px else 0.0
            trades.append(
                Trade(
                    entry_date=dates[entry_idx],
                    entry_price=entry_px,
                    exit_date=dates[exit_idx],
                    exit_price=exit_px,
                    pnl=float(pnl),
                    return_pct=float(ret),
                )
            )
            # Skip the bars while we're in the position; allow immediate re-entry after exit
            i = exit_idx + 1
        else:
            i += 1

    # ---- Build equity curve across entire span (business days), add PnL on exit days
    pnl_by_exit: Dict[str, float] = {}
    for t in trades:
        pnl_by_exit[t.exit_date] = pnl_by_exit.get(t.exit_date, 0.0) + t.pnl

    span_start = df.index[0]
    span_end   = df.index[-1]
    idx = pd.date_range(span_start, span_end, freq="B")

    eq = float(initial_equity)
    rows = []
    first_point_written = False
    for d in idx:
        dstr = d.strftime("%Y-%m-%d")
        if not first_point_written:
            rows.append({"date": dstr, "equity": eq})
            first_point_written = True
        pnl_today = pnl_by_exit.get(dstr, 0.0)
        if pnl_today != 0.0:
            eq += pnl_today
        rows.append({"date": dstr, "equity": eq})

    equity_df = pd.DataFrame(rows).drop_duplicates(subset=["date"], keep="last")
    final_equity = float(equity_df["equity"].iloc[-1]) if not equity_df.empty else initial_equity

    def _mdd(series: pd.Series) -> float:
        if series.empty:
            return 0.0
        peak = series.cummax()
        dd = (series - peak) / peak
        return float(dd.min())

    max_drawdown = _mdd(equity_df["equity"]) if not equity_df.empty else 0.0

    if not equity_df.empty:
        d0 = pd.to_datetime(equity_df["date"].iloc[0])
        d1 = pd.to_datetime(equity_df["date"].iloc[-1])
        days = max((d1 - d0).days, 1)
        years = days / 365.25
        ann_return = (final_equity / initial_equity) ** (1 / years) - 1 if years > 0 else 0.0
    else:
        ann_return = 0.0

    total_pnl = float(sum(t.pnl for t in trades))
    win_rate = float(np.mean([1.0 if t.pnl > 0 else 0.0 for t in trades])) if trades else 0.0
    avg_trade_return = float(np.mean([t.return_pct for t in trades])) if trades else 0.0

    # Convert dataclasses -> dicts (safer JSON)
    trades_out = [asdict(t) for t in trades]

    return {
        "trades": trades_out,
        "equity_df": equity_df,
        "total_pnl": total_pnl,
        "win_rate": win_rate,
        "ann_return": float(ann_return),
        "max_drawdown": float(max_drawdown),
        "final_equity": final_equity,
        "initial_equity": float(initial_equity),
        "avg_trade_return": avg_trade_return,
        "trade_count": len(trades_out),
    }
