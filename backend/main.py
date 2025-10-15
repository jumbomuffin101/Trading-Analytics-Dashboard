from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from datetime import date, datetime, timezone
import numpy as np
from .ingester import ensure_data, load_prices
from .backtest import run_threshold_strategy

app = FastAPI(title="SSMIF Quant Dev Backend", version="0.3.0")

class Health(BaseModel):
    status: str
    time: str

@app.get("/", tags=["meta"])
def index():
    return {
        "service": "SSMIF Quant Dev Backend",
        "endpoints": ["/health", "/peek", "/backtest", "/docs"],
        "hint": "POST /peek {symbol,start,end} ? suggested_threshold; then POST /backtest"
    }

@app.get("/health", response_model=Health, tags=["meta"])
def health():
    return Health(status="ok", time=datetime.now(timezone.utc).isoformat())

class PeekRequest(BaseModel):
    symbol: str
    start: date
    end: date

class BacktestRequest(BaseModel):
    symbol: str
    start: date
    end: date
    threshold: float
    hold_days: int

@app.post("/peek", tags=["data"])
def peek(req: PeekRequest):
    start = req.start.isoformat()
    end = req.end.isoformat()
    # ensure data is present
    try:
        ensure_data(req.symbol, start, end)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Data ingestion failed: {e}")

    df = load_prices(req.symbol, start, end)
    if df.empty:
        raise HTTPException(status_code=404, detail="No data available for given range.")

    closes = df["close"].to_numpy(dtype=float)
    min_close = float(np.nanmin(closes))
    med_close = float(np.nanmedian(closes))
    max_close = float(np.nanmax(closes))
    # suggest a threshold high enough to get fewer, clearer crossovers
    suggested = float(np.nanpercentile(closes, 75))  # 75th percentile

    preview = df.head(5)[["date","open","high","low","close"]]
    preview["date"] = preview["date"].dt.date.astype(str)

    return {
        "symbol": req.symbol.upper(),
        "start": start,
        "end": end,
        "min_close": min_close,
        "median_close": med_close,
        "max_close": max_close,
        "suggested_threshold": suggested,
        "rows": int(len(df)),
        "preview": preview.to_dict(orient="records"),
    }

@app.post("/backtest", tags=["backtest"])
def backtest(req: BacktestRequest):
    start = req.start.isoformat()
    end = req.end.isoformat()
    # 1) ensure data
    try:
        ensure_data(req.symbol, start, end)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Data ingestion failed: {e}")

    # 2) load
    df = load_prices(req.symbol, start, end)
    if df.empty:
        raise HTTPException(status_code=404, detail="No data available for given range.")

    # 3) run strategy
    out = run_threshold_strategy(df, threshold=req.threshold, hold_days=req.hold_days)
    out["symbol"] = req.symbol.upper()
    out["start"] = start
    out["end"] = end
    out["params"] = {"threshold": req.threshold, "hold_days": req.hold_days}
    return out
