# Trading Analytics Dashboard

Live Demo:  
https://jumbomuffin101.github.io/Trading-Analytics-Dashboard/

Trading Analytics Dashboard is an interactive web app for exploring historical stock data, testing simple trading strategies, and visualizing performance metrics. The project is designed as a decision support tool for understanding how different entry and exit rules behave over time, rather than as a production trading system.

The focus is on clarity, explainability, and fast iteration on strategy ideas.

---

## Overview

The application consists of a React and TypeScript frontend paired with a lightweight API that handles market data retrieval and backtest computation.

Users can select a symbol, date range, and strategy parameters, preview market conditions, and run backtests that return equity curves, drawdowns, and trade level statistics. Results are presented through interactive charts and tables optimized for exploration rather than automation.

This project was built to support research and experimentation workflows within the Stevens Student Managed Investment Fund (SSMIF).

---

## Data Flow

1. User selects a symbol, date range, and strategy parameters.
2. The frontend sends a JSON request to `/peek` or `/backtest`.
3. The backend fetches OHLC data and computes trades, equity, and metrics.
4. The response is returned to the frontend and rendered as charts and summaries.

All calculations are performed server side to keep the UI lightweight and deterministic.

---

## Features

- **Market Snapshot (Peek)**  
  Quickly inspect recent price behavior, including minimum, median, and maximum closes, along with a suggested threshold for exploration.

- **Backtesting Engine**  
  Supports absolute breakout, percentage breakout, ATR based breakout, and mean reversion strategies.

- **Interactive Visualizations**  
  Equity curves, price charts with entry and exit markers, and drawdown views built with Recharts.

- **Trade Level Analysis**  
  View individual trades as cards or tables with PnL, return percentage, and holding period.

- **Explainable Metrics**  
  Includes total PnL, win rate, annualized return, max drawdown, profit factor, and average holding duration.

---

## Tech Stack

**Frontend**
- React
- TypeScript
- Vite
- Tailwind CSS
- Recharts

**Backend**
- Python (FastAPI style API)
- Serverless friendly design

**Market Data**
- Yahoo Finance
- Stooq fallback for availability

**Deployment**
- GitHub Pages for the frontend
- Serverless API deployment for backtest computation

---

## Assumptions and Limitations

- Daily close data only
- No transaction costs, slippage, or leverage
- One position at a time
- Not a trading signal generator or financial advice tool

The dashboard is intended for educational and analytical use.

---

## API Endpoints

| Method | Endpoint   | Description              |
|------|------------|--------------------------|
| GET  | /status    | Health check             |
| POST | /peek      | Market snapshot          |
| POST | /backtest  | Run strategy backtest    |
