from fastapi import FastAPI
from pydantic import BaseModel
from datetime import date, datetime, timezone

app = FastAPI(title="SSMIF Quant Dev Backend", version="0.1.0")

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
    # stub for now
    return {"message": "backtest stub", "received": req.model_dump()}
