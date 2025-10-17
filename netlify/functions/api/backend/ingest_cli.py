from __future__ import annotations
import argparse
from datetime import date
from backend.ingester import ensure_data

def valid_date(s: str) -> str:
    # cheap ISO yyyy-mm-dd check; raises ValueError if invalid
    y, m, d = map(int, s.split("-"))
    _ = date(y, m, d)
    return s

def main():
    p = argparse.ArgumentParser(description="SSMIF Ingester CLI: fetch and store price data into the DB")
    p.add_argument("--symbol", required=True, help="Ticker symbol, e.g. AAPL")
    p.add_argument("--start",  required=True, type=valid_date, help="Start date (YYYY-MM-DD)")
    p.add_argument("--end",    required=True, type=valid_date, help="End date (YYYY-MM-DD)")
    args = p.parse_args()

    n = ensure_data(args.symbol, args.start, args.end)
    print(f"Ingest complete for {args.symbol} {args.start}..{args.end} (rows upserted: {n})")

if __name__ == "__main__":
    main()
