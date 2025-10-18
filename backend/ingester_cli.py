# backend/ingester_cli.py
from __future__ import annotations

import argparse
import json
from datetime import datetime

from ingester import fetch_prices  # run from backend/ so relative pkg not needed
from database import upsert_prices, record_coverage

def main() -> None:
    p = argparse.ArgumentParser(description="Fetch price history and store in SQLite.")
    p.add_argument("--symbol", required=True)
    p.add_argument("--start", required=True, help="YYYY-MM-DD")
    p.add_argument("--end",   required=True, help="YYYY-MM-DD")
    args = p.parse_args()

    df, source = fetch_prices(args.symbol, args.start, args.end, prefer="yahoo", allow_fallback=False)
    if df.empty:
        print(json.dumps({"ok": False, "detail": "No data fetched from Yahoo"}))
        raise SystemExit(2)

    rows = []
    for ts, row in df.iterrows():
        rows.append({
            "date": str(ts.date()),
            "open":  float(row.get("open", 0.0)) if "open"  in row else None,
            "high":  float(row.get("high", 0.0)) if "high"  in row else None,
            "low":   float(row.get("low",  0.0)) if "low"   in row else None,
            "close": float(row["close"]),
            "volume": float(row.get("volume", 0.0)) if "volume" in row else None,
        })

    changed = upsert_prices(args.symbol, rows, source)
    record_coverage(args.symbol, args.start, args.end)
    print(json.dumps({"ok": True, "rows": len(rows), "upserted": changed, "source": source}))

if __name__ == "__main__":
    main()
