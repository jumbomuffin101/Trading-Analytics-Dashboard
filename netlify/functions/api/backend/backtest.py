from __future__ import annotations
from dataclasses import dataclass
from typing import List, Dict, Any
import pandas as pd
import numpy as np
from datetime import date as _date

@dataclass
class Trade:
    entry_date: str
    entry_price: float
    exit_date: str
    exit_price: float
    pnl: float
    return_pct: float

def max_drawdown(equity: pd.Series) -> float:
    if equity.empty:
        return 0.0
    peak = equity.cummax()
    dd = (equity - peak) / peak
    return float(dd.min())

def annualized_return(equity: pd.Series) -> float:
    if equity.empty:
        return 0.0
    start_val, end_val = equity.iloc[0], equity.iloc[-1]
    days = (equity.index[-1] - equity.index[0]).days or 1
    years = days / 365.25
    if years <= 0 or start_val <= 0:
        return 0.0
    return float((end_val / start_val) ** (1/years) - 1)

def _clean_prices(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame()
    out = df.copy()
    # parse, sort
    out["date"] = pd.to_datetime(out["date"], errors="coerce")
    out = out.dropna(subset=["date"]).sort_values("date").reset_index(drop=True)
    # keep only positive close
    out = out[out["close"].notna() & (out["close"] > 0)].copy()
    # ensure volume exists; treat missing as 1, then drop zeros
    if "volume" not in out.columns:
        out["volume"] = 1
    out["volume"] = out["volume"].fillna(0)
    out = out[out["volume"] > 0].copy()
    # drop *today* (avoid intraday/partial rows)
    today = _date.today()
    out = out[out["date"].dt.date < today].copy()
    # reindex
    return out.reset_index(drop=True)

def run_threshold_strategy(df: pd.DataFrame, threshold: float, hold_days: int, initial_capital: float = 100000.0):
    """
    Threshold-cross strategy (mark-to-market equity):
      - Enter long when prev_close <= threshold < close.
      - Hold for N trading days, then exit at close.
      - One position at a time, 100% equity sizing.
      - Filters: no NaN/zero close, no zero volume, drop *today* rows.
    """
    df = _clean_prices(df)
    if df.empty:
        return {
            "trades": [],
            "metrics": {
                "total_pnl": 0.0, "win_rate": 0.0, "annualized_return": 0.0,
                "max_drawdown": 0.0, "final_equity": initial_capital, "initial_equity": initial_capital,
            },
            "equity_curve": [],
        }

    last_date = df["date"].max().date()
    df["prev_close"] = df["close"].shift(1)

    trades: List[Trade] = []
    position = None  # (entry_idx, entry_price, shares)
    cash = initial_capital
    equity_vals = []

    for i, row in df.iterrows():
        date = pd.to_datetime(row["date"])
        close = float(row["close"])
        prev_close = float(row["prev_close"]) if not np.isnan(row["prev_close"]) else None

        # Enter at today's close on threshold cross
        if position is None and prev_close is not None and (prev_close <= threshold < close):
            shares = cash / close
            position = (i, close, shares)

        # Mark-to-market equity for the day
        equity_today = cash if position is None else position[2] * close
        equity_vals.append((date, equity_today))

        # Exit after hold_days at close
        if position is not None and (i - position[0]) >= hold_days:
            entry_i, entry_px, shares = position
            exit_px = close
            pnl = (exit_px - entry_px) * shares
            ret = (exit_px / entry_px) - 1.0
            entry_date = pd.to_datetime(df.loc[entry_i, "date"]).date()
            exit_date = date.date()
            if exit_date <= last_date:
                trades.append(Trade(
                    entry_date=str(entry_date),
                    entry_price=float(entry_px),
                    exit_date=str(exit_date),
                    exit_price=float(exit_px),
                    pnl=float(pnl),
                    return_pct=float(ret),
                ))
                cash = equity_today
            position = None

    eq_series = pd.Series([v for _, v in equity_vals],
                          index=[d for d, _ in equity_vals]).sort_index()

    total_pnl = float(sum(t.pnl for t in trades))
    wins = sum(1 for t in trades if t.pnl > 0)
    win_rate = float((wins / len(trades)) if trades else 0.0)
    ann_ret = annualized_return(eq_series)
    mdd = max_drawdown(eq_series)

    return {
        "trades": [t.__dict__ for t in trades],
        "metrics": {
            "total_pnl": total_pnl,
            "win_rate": win_rate,
            "annualized_return": ann_ret,
            "max_drawdown": mdd,
            "final_equity": float(eq_series.iloc[-1]) if not eq_series.empty else float(initial_capital),
            "initial_equity": float(eq_series.iloc[0]) if not eq_series.empty else float(initial_capital),
        },
        "equity_curve": [
            {"date": str(idx.date()), "equity": float(val)}
            for idx, val in eq_series.items()
        ],
    }
