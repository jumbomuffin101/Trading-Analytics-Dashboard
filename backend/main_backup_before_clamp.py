from __future__ import annotations

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import pandas as pd

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
    # ensure data in DB for the requested window
    ensure_data(req.symbol, req.start, req.end)
    df = load_prices(req.symbol, req.start, req.end)

    if df is None or df.empty:
        raise HTTPException(status_code=400, detail="No data available for given range.")

    # stats for UI
    min_close = float(df["close"].min())
    median_close = float(df["close"].median())
    max_close = float(df["close"].max())
    suggested_threshold = float(df["close"].quantile(0.75))

    preview = df[["date", "open", "high", "low", "close"]].copy()
    preview["date"] = pd.to_datetime(preview["date"]).dt.date.astype(str)

    return {
        "symbol": req.symbol.upper(),
        "start": req.start,
        "end": req.end,
        "min_close": min_close,
        "median_close": median_close,
        "max_close": max_close,
        "suggested_threshold": suggested_threshold,
        "rows": int(len(df)),
        "preview": preview.to_dict(orient="records"),
    }

@app.post("/backtest")
def backtest(req: BacktestRequest):
    # make sure data is present
    ensure_data(req.symbol, req.start, req.end)
    df = load_prices(req.symbol, req.start, req.end)

    if df is None or df.empty:
        raise HTTPException(status_code=400, detail="No data available for given range.")

    # run strategy (mark-to-market equity handled inside run_threshold_strategy)
    out = run_threshold_strategy(
        df,
        threshold=float(req.threshold),
        hold_days=int(req.hold_days),
    )

    # add a lightweight price series for the "Price" chart in the UI
    price_series = df[["date", "close"]].copy()
    price_series["date"] = pd.to_datetime(price_series["date"]).dt.date.astype(str)
    out["price_series"] = price_series.to_dict(orient="records")

    # echo request metadata so the UI can label charts
    out["symbol"] = req.symbol.upper()
    out["start"] = req.start
    out["end"] = req.end
    out["params"] = {"threshold": float(req.threshold), "hold_days": int(req.hold_days)}

    return out
