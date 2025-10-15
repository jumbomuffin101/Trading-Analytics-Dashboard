from fastapi import FastAPI
from pydantic import BaseModel
from datetime import date

app = FastAPI(title="SSMIF Quant Dev Backend", version="0.1.0")

class Health(BaseModel):
    status: str
    time: str

@app.get("/health", response_model=Health)
def health():
    from datetime import datetime, timezone
    return Health(status="ok", time=datetime.now(timezone.utc).isoformat())

# Placeholder backtest request schema
class BacktestRequest(BaseModel):
    symbol: str
    start: date
    end: date
    threshold: float
    hold_days: int

@app.post("/backtest")
def backtest(req: BacktestRequest):
    # We'll implement: ensure data -> run simple strategy -> compute metrics -> return JSON
    return {"message": "backtest stub", "received": req.model_dump()}
