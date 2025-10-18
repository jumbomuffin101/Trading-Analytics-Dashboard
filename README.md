# SSMIF Quant Dev Challenge

Full-stack backtest visualizer with:
- **Database:** SQLite (`backend/ssmif.db`)
- **Ingester:** `backend/ingester_cli.py` (Yahoo Finance -> DB)
- **Backend:** FastAPI (`/peek`, `/backtest`) that **auto-fills DB** when needed
- **Frontend:** Vite + React UI that runs peeks/backtests and displays metrics/trades

## Quick Start (Local)

### 1) Backend
```bash
cd backend
python -m venv .venv
.\.venv\Scripts\activate        # Windows PowerShell
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
