# backend/backtest.py
from __future__ import annotations
from dataclasses import dataclass
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
    df: pd.DataFrame,  # expects ['open','high','low','close'] and DatetimeIndex
    threshold: float,
    hold_days: int,
    initial_equity: float = 100_000.0,
) -> Dict[str, Any]:
    """
    Strategy:
      - Enter on a 'cross up': prev close <= threshold AND today close > threshold
      - Hold for N business days, one position at a time (1 share per trade)
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

    df = df.copy()
    df = df.sort_index()
    df["date"] = df.index.strftime("%Y-%m-%d")
    df["prev_close"] = df["close"].shift(1)
    df["cross_up"] = (df["prev_close"] <= threshold) & (df["close"] > threshold)

    dates = df["date"].tolist()
    closes = df["close"].tolist()

    trades: List[Trade] = []
    i = 0
    n = len(df)
    while i < n:
        if bool(df["cross_up"].iloc[i]):
            entry_idx = i
            # hold_days counts business bars, not calendar
            exit_idx = min(i + hold_days, n - 1)
            entry_px = float(closes[entry_idx])
            exit_px = float(closes[exit_idx])
            pnl = exit_px - entry_px             # 1 share PnL
            ret = pnl / entry_px if entry_px else 0.0
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
            i = exit_idx + 1
        else:
            i += 1

    # ---- Build equity curve across entire span (business days), add PnL on exit days
    pnl_by_exit: Dict[str, float] = {}
    for t in trades:
        pnl_by_exit[t.exit_date] = pnl_by_exit.get(t.exit_date, 0.0) + t.pnl

    # full span regardless of trades; ensures short ranges draw correctly
    span_start = df.index[0]
    span_end   = df.index[-1]
    idx = pd.date_range(span_start, span_end, freq="B")

    eq = float(initial_equity)
    rows = []
    # write an initial point on the first business day so the chart starts at initial_equity
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

    # Max drawdown
    def _mdd(series: pd.Series) -> float:
        if series.empty:
            return 0.0
        peak = series.cummax()
        dd = (series - peak) / peak
        return float(dd.min())

    max_drawdown = _mdd(equity_df["equity"]) if not equity_df.empty else 0.0

    # Annualized return based on first & last dates in the span
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

    return {
        "trades": trades,
        "equity_df": equity_df,
        "total_pnl": total_pnl,
        "win_rate": win_rate,
        "ann_return": float(ann_return),
        "max_drawdown": float(max_drawdown),
        "final_equity": final_equity,
        "initial_equity": float(initial_equity),
        "avg_trade_return": avg_trade_return,
        "trade_count": len(trades),
    }
