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
    return_pct: float  # fraction, e.g. 0.05 = 5%

# ---------------------------
# Entry builders (boolean Series)
# ---------------------------
def breakout_entries(df: pd.DataFrame, threshold: float) -> pd.Series:
    """
    True on bars where we open a NEW trade:
      prev close <= threshold AND today's close >= threshold
    """
    c = df["close"].astype(float)
    prev = c.shift(1)
    return (prev <= threshold) & (c >= threshold)

def sma_entries(df: pd.DataFrame, fast: int, slow: int) -> pd.Series:
    """
    True exactly on bullish crossover bars: fast SMA crosses up slow SMA.
    """
    c = df["close"].astype(float)
    f = c.rolling(fast, min_periods=fast).mean()
    s = c.rolling(slow, min_periods=slow).mean()
    # require both SMAs to exist, and a true cross on this bar
    cross = (f >= s) & (f.shift(1) < s.shift(1))
    # if early bars lack SMAs, they'll be NaN -> fill False
    return cross.fillna(False)

def meanrev_entries(df: pd.DataFrame, lookback: int, k_sigma: float) -> pd.Series:
    """
    Long-only mean reversion: enter when z-score <= -k_sigma.
    z = (close - SMA_n) / STD_n
    """
    c = df["close"].astype(float)
    m = c.rolling(lookback, min_periods=lookback).mean()
    s = c.rolling(lookback, min_periods=lookback).std(ddof=0)
    s = s.replace(0, np.nan)
    z = (c - m) / s
    ent = z <= -float(k_sigma)
    return ent.fillna(False)

# ---------------------------
# Stacking engine
# ---------------------------
def run_backtest_stacking(
    df: pd.DataFrame,                  # expects ['close'] with DatetimeIndex
    entries: pd.Series,                # boolean Series aligned to df.index
    hold_days: int,
    initial_equity: float = 100_000.0,
    position_size: float = 1.0,        # shares per signal
) -> Dict[str, Any]:
    """
    Multi-entry, fixed-horizon backtest:
      - Every True in `entries` opens a NEW trade immediately (no in_position suppression).
      - Each trade exits exactly `hold_days` bars later (if within range).
      - P&L realized on exit dates (supports multiple exits same day).
      - Equity carries realized P&L only (no mark-to-market on open trades).
    """
    if df.empty or hold_days < 1:
        return {
            "trades": [],
            "equity_df": pd.DataFrame({"date": [], "equity": []}),
            "total_pnl": 0.0,
            "win_rate": 0.0,
            "ann_return": 0.0,
            "max_drawdown": 0.0,
            "final_equity": float(initial_equity),
            "initial_equity": float(initial_equity),
            "avg_trade_return": 0.0,
            "trade_count": 0,
        }

    df = df.sort_index().copy()
    close = df["close"].astype(float)
    dates = df.index

    ent = entries.reindex(dates).fillna(False).astype(bool).to_numpy()
    entry_idxs = np.flatnonzero(ent)
    exit_idxs = entry_idxs + hold_days
    mask = exit_idxs < len(df)
    entry_idxs = entry_idxs[mask]
    exit_idxs  = exit_idxs[mask]

    trades: List[Trade] = []
    pnl_by_exit: Dict[str, float] = {}

    for ei, xi in zip(entry_idxs, exit_idxs):
        ep = float(close.iloc[ei])
        xp = float(close.iloc[xi])
        pnl = (xp - ep) * position_size
        ret_frac = (pnl / (ep * position_size)) if ep else 0.0

        t = Trade(
            entry_date=str(dates[ei].date()),
            entry_price=ep,
            exit_date=str(dates[xi].date()),
            exit_price=xp,
            pnl=float(pnl),
            return_pct=float(ret_frac),
        )
        trades.append(t)
        pnl_by_exit[t.exit_date] = pnl_by_exit.get(t.exit_date, 0.0) + t.pnl

    # Business-day equity between first/last data point
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

# ---------------------------------------------------------
# ORIGINAL single-position engine (kept for compatibility)
# ---------------------------------------------------------
def run_backtest(
    df: pd.DataFrame,  # expects ['open','high','low','close'] and DatetimeIndex
    threshold: float,
    hold_days: int,
    initial_equity: float = 100_000.0,
) -> Dict[str, Any]:
    """
    Single-position Strategy:
      - Enter on a 'cross up': prev close <= threshold AND today close > threshold
      - Hold for N business days, ONE position at a time (1 share per trade)
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
            exit_idx = min(i + hold_days, n - 1)
            entry_px = float(closes[entry_idx])
            exit_px = float(closes[exit_idx])
            pnl = exit_px - entry_px
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
