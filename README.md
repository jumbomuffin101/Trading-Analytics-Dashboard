**Trading Analytics Dashboard**

Live Demo: [https://jumbomuffin101.github.io/ssmif-quant-dev/](url)

An interactive trading analytics dashboard built by Aryan Rawat for the Stevens Student Managed Investment Fund (SSMIF).
The platform allows users to explore historical stock data, test trading strategies, and visualize performance metrics through a responsive web interface.


**Overview**

This project combines a React + TypeScript frontend with a lightweight serverless backend (Netlify Functions / Cloudflare Workers).
It fetches OHLC data from Yahoo Finance (with a Stooq fallback) and computes detailed analytics including equity curves, drawdowns, and win rates.


**Data Flow**

User Input: Choose a stock symbol, date range, and strategy parameters.

Frontend → Backend: Sends a JSON request to /peek or /backtest.

Backend: Fetches OHLC data, calculates PnL, drawdown, equity curve, and metrics.

Response → UI: Returns JSON that powers interactive charts and tables.



**Features**

Market Snapshot: Instantly view recent high, low, and median closes with suggested entry thresholds.

Backtesting Engine: Supports breakout, SMA crossover, and mean-reversion strategies.

Interactive Charts: Built with Recharts for smooth and responsive visualization.

Detailed Metrics: Includes Profit Factor, Max Drawdown, Annualized Return, and Win Rate.

Modern Stack: Optimized using React, TypeScript, and TailwindCSS.


**Tech Stack**
Layer	Technologies
Frontend	React • TypeScript • Vite • TailwindCSS • Recharts
Backend	Netlify Functions / Cloudflare Workers (FastAPI-style logic)
Data Source	Yahoo Finance API (+ Stooq backup)
Deployment	Netlify (frontend) + Cloudflare Workers (API)


**Deployment**
Netlify (Frontend)
[build]
base = "frontend"
command = "npm ci && npm run build"
publish = "dist"

[[redirects]]
from = "/api/*"
to = "/.netlify/functions/:splat"
status = 200
force = true


**Cloudflare Worker (API)**

Deployed at: [https://ssmif-api..workers.dev](https://ssmif-api.ryanrawat.workers.dev/)

Test endpoint:
curl https://ssmif-api..workers.dev/status


**Key Metrics**
Metric	Description
PnL	Total profit or loss in USD
Win Rate	Percentage of profitable trades
Annualized Return	Compound annual growth rate (CAGR)
Max Drawdown	Largest peak-to-trough equity decline
Profit Factor	Total profit ÷ total loss
Avg Hold Period	Average number of bars held per trade


**Project Structure**

ssmif-quant-dev/
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── index.css
│   │   └── components/
│   ├── vite.config.ts
│   └── package.json
├── backend/
│   ├── main.py
│   └── requirements.txt
├── netlify/
│   └── functions/
└── README.md


**API Endpoints**
Method	Endpoint	Description
GET	/status	Health check
POST	/peek	Fetch market snapshot
POST	/backtest	Run threshold-based backtest
