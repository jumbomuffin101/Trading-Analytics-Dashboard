# 📈 SSMIF Quant Backtest Visualizer

**Deployed at:** [https://jumbomuffin101.github.io/ssmif-quant-dev/](https://jumbomuffin101.github.io/ssmif-quant-dev/)

An interactive **trading analytics dashboard** built by **Aryan Rawat** for the **Stevens Student Managed Investment Fund (SSMIF)**.  
It allows users to explore historical stock data, test trading strategies, and visualize performance metrics — all through a sleek, fast, and responsive web interface.

---

## 🧠 System Architecture

```mermaid
flowchart LR
    A[Frontend<br/>(React + Tailwind + Recharts)] -->|POST /peek, /backtest| B[Serverless Backend<br/>(Netlify Function / Cloudflare Worker)]
    B -->|Fetch OHLC Data| C[(Yahoo Finance API<br/>+ Stooq Backup)]
    B --> D[Computation Layer<br/>(PnL, Equity Curve, Metrics, Trades)]
    D --> A[Charts & Metrics Dashboard]
🔄 Data Flow
User Input – Choose a symbol, start/end dates, and strategy parameters.

Frontend → Backend – Sends a JSON request to /peek or /backtest.

Backend – Fetches OHLC data (Yahoo Finance w/ Stooq fallback) and computes:

Equity Curve

Profit/Loss

Win Rate

Annualized Return

Drawdown

Response → UI – Normalized JSON powers dynamic charts and trade tables.

🚀 Features
🔍 Peek Market Snapshot – Instantly view recent min/median/max closes and a suggested entry threshold.

📊 Strategy Backtesting – Test breakout, SMA crossover, and mean-reversion strategies.

📈 Interactive Visualization – Smooth equity, price, and drawdown charts with Recharts.

💡 Detailed Metrics – Profit Factor, Max Drawdown, Win Rate, Annualized Return, and more.

⚡ Fast & Responsive – Built with React + TypeScript + Vite + TailwindCSS.

🧱 Tech Stack
Layer	Technology
Frontend	React • TypeScript • Vite • TailwindCSS • Recharts
Backend	Netlify Functions / Cloudflare Workers (FastAPI-style logic)
Data Source	Yahoo Finance API (+ Stooq backup)
Deployment	Netlify (frontend) + Cloudflare Workers (API)

⚙️ Local Setup
1️⃣ Clone the Repository
bash
Copy code
git clone https://github.com/jumbomuffin101/ssmif-quant-dev.git
cd ssmif-quant-dev
2️⃣ Frontend Setup
bash
Copy code
cd frontend
npm install
npm run dev
Then open: http://localhost:5173

3️⃣ Backend (Optional Local Test)
bash
Copy code
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
Check health:

arduino
Copy code
http://127.0.0.1:8000/status
🌐 Deployment
✅ Netlify (Frontend)
toml
Copy code
[build]
base = "frontend"
command = "npm ci && npm run build"
publish = "dist"

[[redirects]]
from = "/api/*"
to = "/.netlify/functions/:splat"
status = 200
force = true
☁️ Cloudflare Worker (API)
Deployed at: https://ssmif-api..workers.dev

Test Endpoint:

bash
Copy code
curl https://ssmif-api..workers.dev/status
📊 Example API Usage
/peek
bash
Copy code
curl -X POST -H "Content-Type: application/json" \
-d '{"symbol":"SPY","start":"2025-05-01","end":"2025-08-29"}' \
https://ssmif-api..workers.dev/peek
/backtest
bash
Copy code
curl -X POST -H "Content-Type: application/json" \
-d '{"symbol":"AAPL","threshold":180.5,"hold_days":4,"start":"2025-06-01","end":"2025-09-30"}' \
https://ssmif-api..workers.dev/backtest
🧮 Key Metrics
Metric	Description
PnL	Profit / Loss (USD)
Win Rate	Percentage of profitable trades
Annualized Return	CAGR based on equity growth
Max Drawdown	Largest peak-to-trough equity drop
Profit Factor	Total Profit ÷ Total Loss
Avg Hold Period	Mean bars held per trade

🗂️ Project Structure
pgsql
Copy code
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

👤 Author
Aryan Rawat
