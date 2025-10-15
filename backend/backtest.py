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

def max_drawdown(equity: pd.Series) -> float:
    peak = equity.cummax()
    dd = (equity - peak) / peak
    return dd.min() if len(dd) else 0.0

def annualized_return(equity: pd.Series) -> float:
    if equity.empty:
        return 0.0
    start_val, end_val = equity.iloc[0], equity.iloc[-1]
    days = (equity.index[-1] - equity.index[0]).days or 1
    years = days / 365.25
    if years <= 0 or start_val <= 0:
        return 0.0
    return (end_val / start_val) ** (1/years) - 1

def run_threshold_strategy(df: pd.DataFrame, threshold: float, hold_days: int, initial_capital: float = 100000.0):
    df = df.copy()
    df = df.sort_values("date").reset_index(drop=True)
    df["prev_close"] = df["close"].shift(1)
    trades: List[Trade] = []
    position = None  # store (entry_idx, entry_price)
    equity = []

    # equity curve assumes fully invested per trade, otherwise flat at initial_capital
    cash = initial_capital

    for i, row in df.iterrows():
        date = row["date"]
        close = float(row["close"])
        prev_close = float(row["prev_close"]) if not np.isnan(row["prev_close"]) else None

        # Enter
        if position is None and prev_close is not None:
            if prev_close <= threshold < close:
                position = (i, close)  # entry at today's close

        # Exit
        if position is not None:
            entry_i, entry_px = position
            if i - entry_i >= hold_days:
                # close at today's close
                pnl = (close - entry_px)
                ret = pnl / entry_px
                trades.append(Trade(
                    entry_date=str(df.loc[entry_i, "date"].date()),
                    entry_price=float(entry_px),
                    exit_date=str(date.date()),
                    exit_price=float(close),
                    pnl=float(pnl),
                    return_pct=float(ret),
                ))
                # assume fully invested each trade for equity curve simplicity
                cash *= (1 + ret)
                position = None

        equity.append(cash)

    # Build metrics
    eq_series = pd.Series(equity, index=pd.to_datetime(df["date"]))
    total_pnl = sum(t.pnl for t in trades)
    wins = sum(1 for t in trades if t.pnl > 0)
    win_rate = (wins / len(trades)) if trades else 0.0
    ann_ret = annualized_return(eq_series)
    mdd = max_drawdown(eq_series)

    results: Dict[str, Any] = {
        "trades": [t.__dict__ for t in trades],
        "metrics": {
            "total_pnl": total_pnl,
            "win_rate": win_rate,
            "annualized_return": ann_ret,
            "max_drawdown": mdd,
            "final_equity": float(eq_series.iloc[-1]) if not eq_series.empty else float(initial_capital),
            "initial_equity": float(eq_series.iloc[0]) if not eq_series.empty else float(initial_capital),
        }
    }
    return results
