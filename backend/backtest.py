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
    return_pct: float  # fraction, e.g., 0.05 = 5%

# ---------------------------
# Entry builders (boolean Series)
# ---------------------------

# === EVERY-BAR entry modes (many signals) ===

def breakout_entries_everybar(df: pd.DataFrame, threshold: float) -> pd.Series:
    """
    Open on EVERY bar where close >= threshold.
    """
    c = pd.to_numeric(df["close"], errors="coerce").astype(float)
    return (c >= float(threshold)).fillna(False)

def sma_entries_everybar(df: pd.DataFrame, fast: int, slow: int) -> pd.Series:
    """
    Open on EVERY bar where SMA_fast >= SMA_slow.
    """
    c = pd.to_numeric(df["close"], errors="coerce").astype(float)
    f = c.rolling(int(fast), min_periods=int(fast)).mean()
    s = c.rolling(int(slow), min_periods=int(slow)).mean()
    return (f >= s).fillna(False)

def meanrev_drop_entries(df: pd.DataFrame, drop_pct: float) -> pd.Series:
    """
    Enter long on ANY bar where today's close <= prior close * (1 - drop_pct%).
    - drop_pct is in percent (e.g., 2.0 means -2% or worse vs prior close)
    - Returns a boolean Series aligned to df.index
    """
    c = pd.to_numeric(df["close"], errors="coerce").astype(float)
    prev = c.shift(1)
    thresh = prev * (1.0 - float(drop_pct) / 100.0)
    ent = (c <= thresh)
    return ent.fillna(False)

def breakout_entries(df: pd.DataFrame, threshold: float) -> pd.Series:
    """
    True on bars where a NEW trade opens:
      prev close <= threshold AND today's close >= threshold
    """
    c = pd.to_numeric(df["close"], errors="coerce").astype(float)
    prev = c.shift(1)
    ent = (prev <= threshold) & (c >= threshold)
    return ent.fillna(False)

def sma_entries(df: pd.DataFrame, fast: int, slow: int) -> pd.Series:
    """
    True exactly on bullish crossover bars: SMA_fast crosses UP SMA_slow.
    """
    c = pd.to_numeric(df["close"], errors="coerce").astype(float)
    f = c.rolling(fast, min_periods=fast).mean()
    s = c.rolling(slow, min_periods=slow).mean()
    # Strict cross detection (today above/equal, yesterday at/below)
    cross_up = (f > s) & (f.shift(1) <= s.shift(1))
    return cross_up.fillna(False)

def meanrev_entries(df: pd.DataFrame, lookback: int, k_sigma: float, every_bar: bool = True) -> pd.Series:
    """
    Long-only mean reversion entries.
    If every_bar=True: open a trade on EVERY bar where z <= -k_sigma (many signals).
    If False: only on the first bar crossing into the zone (fewer signals).
    """
    c = pd.to_numeric(df["close"], errors="coerce").astype(float)
    m = c.rolling(lookback, min_periods=lookback).mean()
    s = c.rolling(lookback, min_periods=lookback).std(ddof=0).replace(0, np.nan)
    z = (c - m) / s
    raw = (z <= -float(k_sigma))
    raw = raw.fillna(False)
    if every_bar:
        return raw
    # cross-into-zone only
    return raw & (~raw.shift(1).fillna(False))

# ---------------------------
# Stacking engine
# ---------------------------
def run_backtest_stacking(
    df: pd.DataFrame,                  # expects DatetimeIndex, 'close'
    entries: pd.Series,                # boolean Series aligned to df.index
    hold_days: int,
    initial_equity: float = 100_000.0,
    position_size: float = 1.0,        # shares per signal
) -> Dict[str, Any]:
    """
    Multi-entry, fixed-horizon:
      - Every True in `entries` opens a NEW trade immediately.
      - Each trade exits exactly `hold_days` bars later (if within range).
      - Realize P&L on exit dates. Equity carries realized P&L only.
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
            "debug": {"signals_total": 0, "signals_kept": 0},
        }

    df = df.sort_index().copy()
    close = pd.to_numeric(df["close"], errors="coerce").astype(float)
    dates = df.index

    ent_series = entries.reindex(dates).fillna(False).astype(bool)
    ent = ent_series.to_numpy()
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

    # Business-day equity between first/last date in df
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
        "debug": {
            "signals_total": int(ent_series.sum()),
            "signals_kept": int(len(entry_idxs)),
        },
    }

# ---------------------------------------------------------
# Legacy single-position kept for compatibility (unused by default)
# ---------------------------------------------------------
def run_backtest(
    df: pd.DataFrame,
    threshold: float,
    hold_days: int,
    initial_equity: float = 100_000.0,
) -> Dict[str, Any]:
    df = df.sort_index().copy()
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

    df["date"] = df.index.strftime("%Y-%m-%d")
    c = pd.to_numeric(df["close"], errors="coerce").astype(float)
    df["prev_close"] = c.shift(1)
    df["cross_up"] = (df["prev_close"] <= threshold) & (c > threshold)

    dates = df["date"].tolist()
    closes = c.tolist()
    trades: List[Trade] = []
    i = 0
    n = len(df)
    while i < n:
        if bool(df["cross_up"].iloc[i]):
            entry_idx = i
            exit_idx = min(i + hold_days, n - 1)
            ep = float(closes[entry_idx])
            xp = float(closes[exit_idx])
            pnl = xp - ep
            ret = pnl / ep if ep else 0.0
            trades.append(Trade(dates[entry_idx], ep, dates[exit_idx], xp, float(pnl), float(ret)))
            i = exit_idx + 1
        else:
            i += 1

    pnl_by_exit: Dict[str, float] = {}
    for t in trades:
        pnl_by_exit[t.exit_date] = pnl_by_exit.get(t.exit_date, 0.0) + t.pnl

    span_start = df.index[0]; span_end = df.index[-1]
    idx = pd.date_range(span_start, span_end, freq="B")

    eq = float(initial_equity)
    rows = []
    first_point_written = False
    for d in idx:
        dstr = d.strftime("%Y-%m-%d")
        if not first_point_written:
            rows.append({"date": dstr, "equity": eq}); first_point_written = True
        pnl_today = pnl_by_exit.get(dstr, 0.0)
        if pnl_today != 0.0:
            eq += pnl_today
        rows.append({"date": dstr, "equity": eq})
    equity_df = pd.DataFrame(rows).drop_duplicates(subset=["date"], keep="last")

    final_equity = float(equity_df["equity"].iloc[-1]) if not equity_df.empty else initial_equity

    def _mdd(series: pd.Series) -> float:
        if series.empty: return 0.0
        peak = series.cummax()
        dd = (series - peak) / peak
        return float(dd.min())

    max_drawdown = _mdd(equity_df["equity"]) if not equity_df.empty else 0.0
    if not equity_df.empty:
        d0 = pd.to_datetime(equity_df["date"].iloc[0]); d1 = pd.to_datetime(equity_df["date"].iloc[-1])
        years = max((d1 - d0).days, 1) / 365.25
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
