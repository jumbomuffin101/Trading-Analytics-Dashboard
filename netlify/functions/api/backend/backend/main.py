pip install fastapi uvicorn mangum
pip freeze > requirements.txt

from __future__ import annotations

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import pandas as pd
from datetime import date, timedelta

from .ingester import ensure_data, load_prices
from .backtest import run_threshold_strategy

app = FastAPI(title="SSMIF Quant Dev Backend")

# --------- Models ---------
class PeekRequest(BaseModel):
    symbol: str
    start: str  # ISO date
    end: str    # ISO date

class BacktestRequest(PeekRequest):
    threshold: float
    hold_days: int

# --------- Helpers ---------
def _clamp_dates(start_iso: str, end_iso: str):
    """Clamp end to yesterday (avoid partial intraday data), and ensure start <= end."""
    try:
        s = pd.to_datetime(start_iso).date()
        e = pd.to_datetime(end_iso).date()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")
    yday = date.today() - timedelta(days=1)
    if e > yday:
        e = yday
    if s > e:
        s = e
    return s.isoformat(), e.isoformat(), (e == yday)

# --------- Routes ---------
@app.get("/")
def index():
    return {
        "service": "SSMIF Quant Dev Backend",
        "endpoints": ["/health", "/peek", "/backtest", "/docs"],
        "hint": "POST /backtest with {symbol,start,end,threshold,hold_days}",
    }

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/peek")
def peek(req: PeekRequest):
    start_iso, end_iso, clamped = _clamp_dates(req.start, req.end)
    ensure_data(req.symbol, start_iso, end_iso)
    df = load_prices(req.symbol, start_iso, end_iso)

    if df is None or df.empty:
        raise HTTPException(status_code=400, detail="No data available for given range.")

    # stats for UI
    min_close = float(df["close"].min())
    median_close = float(df["close"].median())
    max_close = float(df["close"].max())
    suggested_threshold = float(df["close"].quantile(0.75))

    preview = df[["date", "open", "high", "low", "close"]].copy()
    preview["date"] = pd.to_datetime(preview["date"]).dt.date.astype(str)

    resp = {
        "symbol": req.symbol.upper(),
        "start": start_iso,
        "end": end_iso,
        "min_close": min_close,
        "median_close": median_close,
        "max_close": max_close,
        "suggested_threshold": suggested_threshold,
        "rows": int(len(df)),
        "preview": preview.to_dict(orient="records"),
    }
    if clamped:
        resp["note"] = "End date was clamped to yesterday to avoid partial intraday data."
    return resp

@app.post("/backtest")
def backtest(req: BacktestRequest):
    start_iso, end_iso, clamped = _clamp_dates(req.start, req.end)
    ensure_data(req.symbol, start_iso, end_iso)
    df = load_prices(req.symbol, start_iso, end_iso)

    if df is None or df.empty:
        raise HTTPException(status_code=400, detail="No data available for given range.")

    out = run_threshold_strategy(
        df,
        threshold=float(req.threshold),
        hold_days=int(req.hold_days),
    )

    # add a lightweight price series for the "Price" chart
    price_series = df[["date", "close"]].copy()
    price_series["date"] = pd.to_datetime(price_series["date"]).dt.date.astype(str)
    out["price_series"] = price_series.to_dict(orient="records")

    # echo request metadata
    out["symbol"] = req.symbol.upper()
    out["start"] = start_iso
    out["end"] = end_iso
    out["params"] = {"threshold": float(req.threshold), "hold_days": int(req.hold_days)}
    if clamped:
        out["note"] = "End date was clamped to yesterday to avoid partial intraday data."
    return out
