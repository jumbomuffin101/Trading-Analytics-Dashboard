import { useMemo, useState, useEffect } from "react";
import axios from "axios";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  LineChart, Line, ReferenceLine,
} from "recharts";
import "./index.css";

type PeekResponse = {
  symbol: string; start: string; end: string;
  min_close: number; median_close: number; max_close: number;
  suggested_threshold: number; rows: number;
  preview: { date: string; open: number; high: number; low: number; close: number }[];
};

type Trade = {
  entry_date: string; entry_price: number;
  exit_date: string;  exit_price: number;
  pnl: number; return_pct: number;
};

type BacktestResponse = {
  symbol: string; start: string; end: string;
  params: { threshold: number; hold_days: number };
  metrics: { total_pnl: number; win_rate: number; annualized_return: number; max_drawdown: number; final_equity: number; initial_equity: number };
  trades: Trade[];
  equity_curve: { date: string; equity: number }[];
  price_series?: { date: string; close: number }[];
};

function Stat({ label, value, sub }: { label:string; value:string; sub?:string }) {
  return (
    <div className="p-5 rounded-xl bg-slate-900/40 border border-slate-800">
      <div className="text-sm text-slate-400">{label}</div>
      <div className="text-3xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
    </div>
  );
}

const PRESETS = ["AAPL","MSFT","NVDA","AMZN","META","GOOGL","TSLA","SPY","QQQ","NFLX"];
const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {month:"short", day:"numeric", year:"numeric"}).format(new Date(iso));
type ChartMode = "equity" | "price";

export default function App() {
  // default to last 90 days (recent)
  const today = new Date();
  const endISO = today.toISOString().slice(0,10);
  const startDate = new Date(); startDate.setDate(startDate.getDate() - 90);
  const startISO = startDate.toISOString().slice(0,10);

  const [symbol, setSymbol] = useState("AAPL");
  const [start, setStart] = useState(startISO);
  const [end, setEnd]     = useState(endISO);

  // editable strings, validated on submit
  const [threshold, setThreshold] = useState<string>("");
  const [holdDays, setHoldDays]   = useState<string>("5");

  const [peek, setPeek]           = useState<PeekResponse | null>(null);
  const [result, setResult]       = useState<BacktestResponse | null>(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [mode, setMode]           = useState<ChartMode>("equity");

  const datalist = useMemo(() => PRESETS, []);\n  // --- Trade helpers ---
  const tradesSummary = (trades: any[] = []) => {
    const count = trades.length;
    const totalPnL = trades.reduce((s, t) => s + (t?.pnl ?? 0), 0);
    const avgRet = count ? trades.reduce((s, t) => s + (t?.return_pct ?? 0), 0) / count : 0;
    const wins = trades.reduce((s, t) => s + ((t?.pnl ?? 0) > 0 ? 1 : 0), 0);
    const winRate = count ? wins / count : 0;
    return { count, totalPnL, avgRet, winRate };
  };

  const daysBetween = (a: string, b: string) => {
    const da = new Date(a + "T00:00:00Z");
    const db = new Date(b + "T00:00:00Z");
    return Math.max(0, Math.round((db.getTime() - da.getTime()) / (1000 * 60 * 60 * 24)));
  };

  const exportTradesCsv = () => {
    if (!result?.trades?.length) return;
    const rows = [
      ["Entry Date","Entry Price","Exit Date","Exit Price","PnL","Return %","Days"],
      ...result.trades.map(t => [
        t.entry_date,
        t.entry_price.toFixed(4),
        t.exit_date,
        t.exit_price.toFixed(4),
        t.pnl.toFixed(2),
        (t.return_pct*100).toFixed(2),
        String(daysBetween(t.entry_date, t.exit_date)),
      ])
    ];
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trades_${symbol}_${start}_to_${end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };\n  // --- Trade helpers ---
  const tradesSummary = (trades: any[] = []) => {
    const count = trades.length;
    const totalPnL = trades.reduce((s, t) => s + (t?.pnl ?? 0), 0);
    const avgRet = count ? trades.reduce((s, t) => s + (t?.return_pct ?? 0), 0) / count : 0;
    const wins = trades.reduce((s, t) => s + ((t?.pnl ?? 0) > 0 ? 1 : 0), 0);
    const winRate = count ? wins / count : 0;
    return { count, totalPnL, avgRet, winRate };
  };

  const daysBetween = (a: string, b: string) => {
    const da = new Date(a + "T00:00:00Z");
    const db = new Date(b + "T00:00:00Z");
    return Math.max(0, Math.round((db.getTime() - da.getTime()) / (1000 * 60 * 60 * 24)));
  };

  const exportTradesCsv = () => {
    if (!result?.trades?.length) return;
    const rows = [
      ["Entry Date","Entry Price","Exit Date","Exit Price","PnL","Return %","Days"],
      ...result.trades.map(t => [
        t.entry_date,
        t.entry_price.toFixed(4),
        t.exit_date,
        t.exit_price.toFixed(4),
        t.pnl.toFixed(2),
        (t.return_pct*100).toFixed(2),
        String(daysBetween(t.entry_date, t.exit_date)),
      ])
    ];
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trades_${symbol}_${start}_to_${end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };// load saved settings (if any)
  useEffect(() => {
    try {
      const raw = localStorage.getItem("ssmif-settings");
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.symbol) setSymbol(String(s.symbol));
      if (s.start) setStart(String(s.start));
      if (s.end) setEnd(String(s.end));
      if (s.threshold !== undefined) setThreshold(String(s.threshold));
      if (s.holdDays !== undefined) setHoldDays(String(s.holdDays));
    } catch {}
  }, []);

  const parseThreshold = (): number | null => {
    if (threshold.trim() === "") return null;
    const v = Number(threshold);
    return Number.isFinite(v) ? v : null;
  };
  const parseHoldDays = (): number | null => {
    if (holdDays.trim() === "") return null;
    const n = Number(holdDays);
    return Number.isInteger(n) && n >= 1 ? n : null;
  };

  const saveSettings = () => {
    const payload = {
      symbol,
      start,
      end,
      threshold: parseThreshold() ?? threshold,
      holdDays: parseHoldDays() ?? holdDays,
    };
    localStorage.setItem("ssmif-settings", JSON.stringify(payload));
  };

  const doPeek = async () => {
    setError(null); setResult(null); setLoading(true);
    try {
      const res = await axios.post<PeekResponse>("/api/peek", { symbol, start, end });
      setPeek(res.data);
      setThreshold(res.data.suggested_threshold.toFixed(2));
    } catch (e:any) {
      setError(e?.response?.data?.detail ?? e.message);
    } finally { setLoading(false); }
  };

  const doBacktest = async () => {
    setError(null); setLoading(true); setResult(null);
    try {
      const thr = parseThreshold();
      const hd  = parseHoldDays();
      if (thr === null) { throw new Error("Please enter a valid numeric threshold (try Peek)."); }
      if (hd  === null) { throw new Error("Hold Days must be a whole number >= 1."); }
      const res = await axios.post<BacktestResponse>("/api/backtest", {
        symbol, start, end, threshold: thr, hold_days: hd,
      });
      setResult(res.data);
    } catch (e:any) {
      setError(e?.response?.data?.detail ?? e.message);
    } finally { setLoading(false); }
  };

  const thrInvalid = threshold.trim() !== "" && parseThreshold() === null;
  const hdInvalid  = holdDays.trim() !== "" && parseHoldDays() === null;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-950 to-black" />
        <div className="relative mx-auto max-w-6xl px-4 pt-12 pb-14">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-bull-600 flex items-center justify-center font-black">$</div>
            <h1 className="text-4xl font-bold">Trading Analytics Dashboard</h1>
          </div>
          <p className="mt-3 text-slate-300 text-base max-w-3xl">
            Interactive backtesting sandbox built with FastAPI and React. It ingests historical prices on-demand,
            suggests a statistically grounded entry threshold, and evaluates a simple hold-for-N-days strategy
            across your chosen window. Includes equity curve, trade ledger, and core risk/return metrics.
          </p>

          {/* About This Strategy */}
          <div className="mt-6 p-6 rounded-xl bg-slate-900/40 border border-slate-800 shadow-card">
            <h2 className="text-xl font-semibold text-bull-400 mb-2">About This Strategy</h2>
            <p className="text-slate-300 leading-relaxed">
              This backtest implements a <span className="font-semibold">Price Threshold Strategy</span> on daily closes.
              When yesterday&apos;s close is at or below a chosen threshold and today&apos;s close is above it,
              the system goes long at today&apos;s close and exits after a fixed number of trading days.
              One position at a time, with 100% equity sizing for compounding. We report per-trade outcomes,
              a mark-to-market equity curve, win rate, annualized return, and max drawdown.
            </p>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto max-w-6xl px-4 pt-6 pb-24">
        {/* Form card */}
        <div className="card p-7">
          {/* Preset chips */}
          <div className="flex flex-wrap gap-2 mb-4">
            {PRESETS.map(sym => (
              <button
                key={sym}
                className={`chip ${symbol === sym ? "active" : ""}`}
                onClick={() => setSymbol(sym)}
                type="button"
                title={`Use ${sym}`}
              >
                {sym}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <label className="text-sm">
              <div className="mb-1 text-slate-300">Symbol</div>
              <input
                className="input"
                value={symbol}
                onChange={e=>setSymbol(e.target.value.toUpperCase())}
                list="symbols"
                placeholder="e.g. AAPL"
              />
              <datalist id="symbols">
                {datalist.map(s => <option key={s} value={s} />)}
              </datalist>
            </label>

            <label className="text-sm">
              <div className="mb-1 text-slate-300">Start</div>
              <input className="input" type="date" value={start} onChange={e=>setStart(e.target.value)}/>
            </label>
            <label className="text-sm">
              <div className="mb-1 text-slate-300">End</div>
              <input className="input" type="date" value={end} onChange={e=>setEnd(e.target.value)}/>
            </label>
            <label className="text-sm">
              <div className="mb-1 text-slate-300">Threshold</div>
              <input
                className={`input ${thrInvalid ? "ring-2 ring-bear-500" : ""}`}
                inputMode="decimal" step="any"
                value={threshold}
                onChange={e=>setThreshold(e.target.value)}
                placeholder="e.g. 185.75"
              />
              {thrInvalid && <div className="text-xs text-bear-400 mt-1">Enter a finite number.</div>}
            </label>
            <label className="text-sm">
              <div className="mb-1 text-slate-300">Hold Days</div>
              <input
                className={`input ${hdInvalid ? "ring-2 ring-bear-500" : ""}`}
                inputMode="numeric" pattern="[0-9]*" min={1}
                value={holdDays}
                onChange={e=>setHoldDays(e.target.value)}
                placeholder=">= 1"
              />
              {hdInvalid && <div className="text-xs text-bear-400 mt-1">Whole number, at least 1.</div>}
            </label>
          </div>

          <div className="flex flex-wrap gap-3 mt-5">
            <button className="btn-primary" onClick={doPeek} disabled={loading}>Peek</button>
            <button className="btn-ghost" onClick={doBacktest} disabled={loading}>Run Backtest</button>
            <button className="btn-ghost" onClick={saveSettings} disabled={loading}>Save Settings</button>
            {loading && <span className="text-slate-400">Loading...</span>}
            {error && <span className="text-bear-400">Error: {error}</span>}
          </div>
        </div>

        {/* Peek summary */}
        {peek && (
          <div className="card p-8 mt-8 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-2xl font-bold tracking-tight text-bull-400">{peek.symbol} Market Snapshot</h3>
                <div className="text-sm text-slate-400">{fmtDate(peek.start)} - {fmtDate(peek.end)}</div>
              </div>
              <div className="text-sm text-slate-400">Rows: {peek.rows}</div>
            </div>
            <div className="grid sm:grid-cols-4 gap-4">
              <Stat label="Min Close" value={peek.min_close.toFixed(2)} />
              <Stat label="Median Close" value={peek.median_close.toFixed(2)} />
              <Stat label="Max Close" value={peek.max_close.toFixed(2)} />
              <Stat label="Suggested Threshold" value={peek.suggested_threshold.toFixed(2)} sub="75th percentile"/>
            </div>
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="grid lg:grid-cols-3 gap-6 mt-6">
            {/* Chart card */}
            <div className="card p-7 lg:col-span-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-semibold">
                  {mode === "equity" ? "Equity Curve" : "Price & Threshold"}
                </h3>
                <div className="flex items-center gap-2">
                  <div className="text-sm text-slate-400 mr-2">
                    {fmtDate(result.start)} - {fmtDate(result.end)} - {result.symbol}
                  </div>
                  <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-1">
                    <button
                      className={`px-3 py-1 rounded-md ${mode==="equity" ? "bg-bull-600 text-white" : "text-slate-200"}`}
                      onClick={()=>setMode("equity")}
                    >Equity</button>
                    <button
                      className={`px-3 py-1 rounded-md ${mode==="price" ? "bg-bull-600 text-white" : "text-slate-200"}`}
                      onClick={()=>setMode("price")}
                    >Price</button>
                  </div>
                </div>
              </div>

              {/* Chart */}
              <div className="w-full h-[380px] mt-3">
                <ResponsiveContainer>
                  {mode === "equity" ? (
                    <AreaChart data={result.equity_curve}>
                      <defs>
                        <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.35}/>
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0.02}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(148,163,184,0.15)" vertical={false}/>
                      <XAxis dataKey="date" minTickGap={28} stroke="#94a3b8"/>
                      <YAxis stroke="#94a3b8" />
                      <Tooltip contentStyle={{ background:"#0f172a", border:"1px solid #1f2937", borderRadius:12 }}/>
                      <Area type="monotone" dataKey="equity" stroke="#10b981" fill="url(#eqFill)" strokeWidth={2} />
                    </AreaChart>
                  ) : (
                    <LineChart
                      data={result.price_series ?? []}
                      margin={{ left: 10, right: 10, top: 10, bottom: 10 }}
                    >
                      <CartesianGrid stroke="rgba(148,163,184,0.15)" vertical={false}/>
                      <XAxis dataKey="date" minTickGap={28} stroke="#94a3b8"/>
                      <YAxis stroke="#94a3b8" />
                      <Tooltip contentStyle={{ background:"#0f172a", border:"1px solid #1f2937", borderRadius:12 }}/>
                      <Line type="monotone" dataKey="close" stroke="#60a5fa" dot={false} strokeWidth={2}/>
                      <ReferenceLine y={parseThreshold() ?? undefined} stroke="#f59e0b" strokeDasharray="4 4" />
                    </LineChart>
                  )}
                </ResponsiveContainer>
              </div>

              {/* Metrics row */}
              <div className="grid sm:grid-cols-3 gap-4 mt-5">
                <Stat label="PnL" value={result.metrics.total_pnl.toFixed(2)} />
                <Stat label="Win Rate" value={(result.metrics.win_rate*100).toFixed(1) + "%"} />
                <Stat label="Ann. Return" value={(result.metrics.annualized_return*100).toFixed(2) + "%"} />
              </div>
              <div className="grid sm:grid-cols-2 gap-4 mt-4">
                <Stat label="Final Equity" value={result.metrics.final_equity.toFixed(2)} />
                <Stat label="Max Drawdown" value={(result.metrics.max_drawdown*100).toFixed(2) + "%"} />
              </div>
            </div>

            {/* Trades card */}
            <div className="card p-7">
  <div className="flex items-center justify-between mb-4">
    <h3 className="text-xl font-semibold">Trades ({result.trades?.length ?? 0})</h3>
    <div className="flex gap-2">
      <button className="btn-ghost" onClick={exportTradesCsv}>Download CSV</button>
    </div>
  </div>
  <div className="max-h-[420px] overflow-auto">
    <table className="table w-full text-sm">
      <thead>
        <tr>
          <th>Entry</th><th className="text-right">Entry Px</th>
          <th>Exit</th><th className="text-right">Exit Px</th>
          <th className="text-right">PnL</th>
          <th className="text-right">%</th>
          <th className="text-right">Days</th>
        </tr>
      </thead>
      <tbody>
        {(result.trades ?? []).map((t, i) => {
          const positive = t.pnl >= 0;
          return (
            <tr key={i} className="hover:bg-slate-900/50">
              <td>{t.entry_date}</td>
              <td className="text-right">{t.entry_price.toFixed(2)}</td>
              <td>{t.exit_date}</td>
              <td className="text-right">{t.exit_price.toFixed(2)}</td>
              <td className={`text-right ${positive ? "text-bull-400" : "text-bear-400"}`}>{t.pnl.toFixed(2)}</td>
              <td className={`text-right ${positive ? "text-bull-400" : "text-bear-400"}`}>{(t.return_pct*100).toFixed(2)}%</td>
              <td className="text-right">{daysBetween(t.entry_date, t.exit_date)}</td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        {(() => {
          const s = tradesSummary(result.trades ?? []);
          return (
            <tr className="bg-slate-900/40">
              <td className="font-semibold">Totals</td>
              <td></td>
              <td></td>
              <td className="text-right font-semibold">Trades: {s.count}</td>
              <td className="text-right font-semibold">{s.totalPnL.toFixed(2)}</td>
              <td className="text-right font-semibold">{(s.avgRet*100).toFixed(2)}%</td>
              <td className="text-right font-semibold">{(s.winRate*100).toFixed(1)}%</td>
            </tr>
          );
        })()}
      </tfoot>
    </table>
  </div>
</div>
          </div>
        )}
      </div>
    </div>
  );
}



