from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from datetime import date, datetime, timezone
from .ingester import ensure_data, load_prices
from .backtest import run_threshold_strategy

app = FastAPI(title="SSMIF Quant Dev Backend", version="0.2.0")

class Health(BaseModel):
    status: str
    time: str

@app.get("/health", response_model=Health)
def health():
    return Health(status="ok", time=datetime.now(timezone.utc).isoformat())

class BacktestRequest(BaseModel):
    symbol: str
    start: date
    end: date
    threshold: float
    hold_days: int

@app.post("/backtest")
def backtest(req: BacktestRequest):
    start = req.start.isoformat()
    end = req.end.isoformat()
    # 1) ensure data exists in DB
    try:
        ensure_data(req.symbol, start, end)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Data ingestion failed: {e}")

    # 2) load from DB
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
