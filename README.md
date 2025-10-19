🧩 1️⃣ Final README.md (with architecture diagram)
# 📈 SSMIF Backtest Visualizer

An interactive trading analytics dashboard built by **Aryan Rawat** for the Stevens Student Managed Investment Fund (SSMIF).  
This app lets users analyze historical stock data, backtest trading strategies, and visualize performance metrics — all in one beautiful, lightweight web interface.

---

## 🧠 System Architecture

```mermaid
flowchart LR
    A[User Browser<br/>(React + Tailwind + Recharts)] -->|API Calls /fetch, /peek, /backtest| B[Cloudflare Worker / Netlify Function<br/>(FastAPI Equivalent Logic)]
    B -->|Fetch OHLC Data| C[(Yahoo Finance API<br/>+ Stooq Backup)]
    B --> D[Computation Layer<br/>(Equity Curve, Metrics, Trades)]
    D --> A


Data Flow Summary:

User interacts with the React UI and sets parameters (symbol, start, end, threshold, hold days).

Frontend sends JSON payload to the backend /peek or /backtest routes.

Backend fetches OHLC price data from Yahoo Finance or Stooq, then computes:

PnL, Equity Curve, Win Rate, Drawdown, etc.

Backend returns normalized JSON results → rendered into charts using Recharts.

🚀 Features

Peek Market Snapshot: Instantly view recent stock price ranges, medians, and thresholds.

Dynamic Strategy Backtesting: Simulate “cross-above-threshold” trading strategies.

Real-time Visualization: Interactive charts for equity curves & trade markers.

Performance Metrics: Profit Factor, Drawdown, Win Rate, Annualized Return, etc.

Responsive & Fast: Built with React + TypeScript + TailwindCSS + Vite.

🧱 Tech Stack
Layer	Technology
Frontend	React + TypeScript + Vite + TailwindCSS + Recharts
Backend	Cloudflare Worker / Netlify Function (FastAPI-style logic)
Data Source	Yahoo Finance + Stooq
Deployment	Netlify (Frontend) + Cloudflare (API Worker)
⚙️ Local Setup
Clone the Repository
git clone https://github.com/<your-username>/ssmif-quant-dev.git
cd ssmif-quant-dev

Frontend Setup
cd frontend
npm install
npm run dev


Then open http://localhost:5173

Backend (optional local test)
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000


Test:

http://127.0.0.1:8000/status

🌐 Deployment Notes
✅ Netlify (Frontend)
[build]
  base = "frontend"
  command = "npm ci && npm run build"
  publish = "dist"

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/:splat"
  status = 200
  force = true

☁️ Cloudflare Worker (Backend)

Deployed at:

https://ssmif-api.<your-namespace>.workers.dev


Example test:

curl https://ssmif-api.<your-namespace>.workers.dev/status

📊 Example API Usage
/peek
curl -X POST -H "Content-Type: application/json" \
  -d '{"symbol":"SPY","start":"2025-05-01","end":"2025-08-29"}' \
  https://ssmif-api.<your-namespace>.workers.dev/peek

/backtest
curl -X POST -H "Content-Type: application/json" \
  -d '{"symbol":"AAPL","threshold":180.5,"hold_days":4,"start":"2025-06-01","end":"2025-09-30"}' \
  https://ssmif-api.<your-namespace>.workers.dev/backtest

🧮 Key Metrics Explained
Metric	Description
PnL	Profit/Loss in USD
Win Rate	Percentage of profitable trades
Annualized Return	CAGR based on total equity gain
Max Drawdown	Largest equity drop from peak
Profit Factor	Total Profit ÷ Total Loss
Average Hold Period	Mean number of bars held per trade
🗂️ Project Structure
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

🧩 API Endpoints
Method	Endpoint	Description
GET	/status	Health check
POST	/peek	Fetch market snapshot
POST	/backtest	Run threshold-based backtest
🧠 Author

Aryan Rawat
Stevens Institute of Technology — School of Systems & Enterprises

Quantitative Finance • Software Systems • Applied AI

GitHub: @JumboMuffin101

🪙 License

MIT License — Free for educational and research use.

💬 Acknowledgements

Recharts
 for charting

TailwindCSS
 for UI

FastAPI
 for backend structure

Cloudflare Workers
 + Netlify
 for deployment