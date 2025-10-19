import { useEffect, useMemo, useState } from "react";
import axios from "axios";

// ===== 1) Axios client that points to your Worker in production =====
//   * VITE_API_BASE comes from your GitHub Secret (or .env.production)
//   * Fallback to "/api" lets local dev work if you proxy
const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || "/api",
  timeout: 20000,
});

// ===== 2) Types (match what the Worker returns in our last message) =====
type OHLC = { date: string; open: number; high: number; low: number; close: number };

type PeekResponse = {
  symbol: string; start: string; end: string;
  min_close: number; median_close: number; max_close: number;
  suggested_threshold: number; rows: number; preview: OHLC[];
};

type Trade = {
  entry_date: string; entry_price: number;
  exit_date: string;  exit_price: number;
  pnl: number; return_pct: number;
};

type BacktestResponse = {
  symbol: string; start: string; end: string;
  equity_start: number; equity_end: number;
  equity_curve: { date: string; equity: number }[];
  trades: Trade[];
  best_trade: Trade; worst_trade: Trade;
  total_trades: number; win_rate_pct: number;
};

// ===== 3) Small helpers to avoid "Cannot read properties of undefined (toFixed)" =====
const fmt = (x: unknown, d = 2) => {
  const n = typeof x === "number" && isFinite(x) ? x : 0;
  return n.toFixed(d);
};
const safe = <T,>(v: T | undefined | null, fallback: T) => (v ?? fallback);

export default function App() {
  const [symbol, setSymbol] = useState<string>(""); // start with none selected
  const [peek, setPeek] = useState<PeekResponse | null>(null);
  const [backtest, setBacktest] = useState<BacktestResponse | null>(null);

  const [loadingPeek, setLoadingPeek] = useState(false);
  const [loadingBt, setLoadingBt] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Debug: confirm what URL your build embedded
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log("VITE_API_BASE =", import.meta.env.VITE_API_BASE);
  }, []);

  // ===== 4) Button handlers (the important part) =====
  const handlePeek = async () => {
    try {
      setErr(null);
      setLoadingPeek(true);
      setBacktest(null);

      // you can include additional options here (start/end/threshold) if your UI collects them
      const body = { symbol: symbol || "SPY" };
      const { data } = await api.post<PeekResponse>("/peek", body);

      // Guard for numbers so UI never crashes
      const fixed: PeekResponse = {
        ...data,
        min_close: Number(data.min_close ?? 0),
        median_close: Number(data.median_close ?? 0),
        max_close: Number(data.max_close ?? 0),
        suggested_threshold: Number(data.suggested_threshold ?? 0),
        rows: Number(data.rows ?? (data.preview?.length ?? 0)),
        preview: Array.isArray(data.preview) ? data.preview : [],
      };
      setPeek(fixed);
    } catch (e: any) {
      console.error(e);
      setErr(e?.message || "Peek failed");
    } finally {
      setLoadingPeek(false);
    }
  };

  const handleBacktest = async () => {
    try {
      setErr(null);
      setLoadingBt(true);

      // If your local code used threshold/dates, include them here from state/inputs.
      const body = { symbol: symbol || "SPY" };
      const { data } = await api.post<BacktestResponse>("/backtest", body);

      // Normalize numbers & arrays
      const fixed: BacktestResponse = {
        ...data,
        equity_start: Number(data.equity_start ?? 1000),
        equity_end: Number(data.equity_end ?? 1000),
        equity_curve: Array.isArray(data.equity_curve) ? data.equity_curve : [],
        trades: Array.isArray(data.trades) ? data.trades : [],
        best_trade: data.best_trade ?? { entry_date: "", entry_price: 0, exit_date: "", exit_price: 0, pnl: 0, return_pct: 0 },
        worst_trade: data.worst_trade ?? { entry_date: "", entry_price: 0, exit_date: "", exit_price: 0, pnl: 0, return_pct: 0 },
        total_trades: Number(data.total_trades ?? (data.trades?.length ?? 0)),
        win_rate_pct: Number(data.win_rate_pct ?? 0),
      };
      setBacktest(fixed);
    } catch (e: any) {
      console.error(e);
      setErr(e?.message || "Backtest failed");
    } finally {
      setLoadingBt(false);
    }
  };

  // ===== 5) Render (minimal example; keep your existing layout/charts) =====
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
      <h1>SSMIF Quant</h1>

      {/* Symbol picker (keep whatever you had locally; starting empty matches your earlier request) */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <label>Symbol:</label>
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          placeholder="e.g. SPY"
          style={{ width: 120, padding: 6 }}
        />
        <button onClick={handlePeek} disabled={loadingPeek}>
          {loadingPeek ? "Peeking..." : "Peek"}
        </button>
        <button onClick={handleBacktest} disabled={loadingBt}>
          {loadingBt ? "Running..." : "Run Backtest"}
        </button>
      </div>

      {err && (
        <div style={{ color: "crimson", marginBottom: 8 }}>
          Error: {err}
        </div>
      )}

      {/* Peek snapshot */}
      {peek && (
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <h3>Market Snapshot ({peek.symbol})</h3>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div>Start: {peek.start}</div>
            <div>End: {peek.end}</div>
            <div>Rows: {peek.rows}</div>
            <div>Min: {fmt(peek.min_close)}</div>
            <div>Median: {fmt(peek.median_close)}</div>
            <div>Max: {fmt(peek.max_close)}</div>
            <div>Suggested threshold: {fmt(peek.suggested_threshold)}</div>
          </div>
        </div>
      )}

      {/* Backtest summary */}
      {backtest && (
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          <h3>Backtest ({backtest.symbol})</h3>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 8 }}>
            <div>Start: {backtest.start}</div>
            <div>End: {backtest.end}</div>
            <div>Equity start: {fmt(backtest.equity_start)}</div>
            <div>Equity end: {fmt(backtest.equity_end)}</div>
            <div>Total trades: {backtest.total_trades}</div>
            <div>Win rate: {fmt(backtest.win_rate_pct)}%</div>
          </div>

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div>
              <strong>Best trade</strong><br />
              {fmt(backtest.best_trade?.return_pct)}%
            </div>
            <div>
              <strong>Worst trade</strong><br />
              {fmt(backtest.worst_trade?.return_pct)}%
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
