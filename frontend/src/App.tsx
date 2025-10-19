import { useMemo, useState, useEffect } from "react";
import axios from "axios";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  LineChart, Line, ReferenceLine, ReferenceDot, Label
} from "recharts";
import DrawdownChart from "./components/DrawdownChart";
import { exportTradesCSV } from "./utils/csv";
import "./index.css";

/* ========== API + Normalizers ========== */
const BASE = (import.meta as any).env?.VITE_API_BASE || "/api";
const api = axios.create({ baseURL: BASE, timeout: 25000 });

const n = (x: unknown, d = 2) => +((typeof x === "number" && isFinite(x) ? x : 0).toFixed(d));
const pick = <T,>(...xs: T[]) => xs.find((v) => v !== undefined && v !== null) as T;

function normalizePeek(raw: any) {
  const preview = Array.isArray(raw?.preview) ? raw.preview : [];
  return {
    symbol: String(raw?.symbol ?? ""),
    start: raw?.start ?? preview[0]?.date ?? "",
    end: raw?.end ?? preview[preview.length - 1]?.date ?? "",
    min_close: n(pick(raw?.stats?.min_close, raw?.min_close, 0)),
    median_close: n(pick(raw?.stats?.median_close, raw?.median_close, 0)),
    max_close: n(pick(raw?.stats?.max_close, raw?.max_close, 0)),
    suggested_threshold: +n(pick(raw?.stats?.suggested_threshold, raw?.suggested_threshold, 0), 3),
    rows: typeof raw?.rows === "number" ? raw.rows : preview.length || 0,
    preview,
    note: raw?.detail || raw?.note,
  };
}
const toPct = (x: unknown) => {
  const v = Number(x);
  if (!isFinite(v)) return 0;
  return Math.abs(v) > 1 ? v / 100 : v;
};
function maxDD(eq: { equity: number }[]) {
  let p = eq[0]?.equity ?? 0, m = 0;
  for (const x of eq) { if (x.equity > p) p = x.equity; m = Math.min(m, p ? (x.equity - p) / p : 0); }
  return Math.abs(m);
}
function normalizeBacktest(raw: any, req: any) {
  const equity_curve = Array.isArray(raw?.equity_curve) ? raw.equity_curve : (raw?.equityCurve ?? []);
  const trades = (raw?.trades ?? []).map((t: any) => ({
    entry_date: String(t.entry_date ?? ""), entry_price: n(t.entry_price),
    exit_date: String(t.exit_date ?? ""),  exit_price: n(t.exit_price),
    pnl: n(t.pnl), return_pct: toPct(t.return_pct),
  }));
  const threshold = isFinite(+req?.threshold) ? +req.threshold : +pick(raw?.params?.threshold, raw?.threshold, 0);
  const hold_days = isFinite(+req?.hold_days) ? +req.hold_days : +pick(raw?.params?.hold_days, raw?.hold_days, 0);

  const initial_equity = n(pick(raw?.metrics?.initial_equity, raw?.equity_start, 1000));
  const lastEq = equity_curve.at(-1)?.equity ?? initial_equity;
  const final_equity = n(pick(raw?.metrics?.final_equity, raw?.equity_end, lastEq));
  const total_pnl = n(final_equity - initial_equity);
  const win_rate = n(pick(raw?.metrics?.win_rate, raw?.win_rate_pct, 0), 4) / (raw?.metrics?.win_rate ? 1 : 100);

  const start = String(raw?.start ?? "");
  const end = String(raw?.end ?? "");
  let annualized_return = 0;
  try {
    const yrs = (new Date(end).getTime() - new Date(start).getTime()) / 86400000 / 365;
    if (yrs > 0 && initial_equity > 0) annualized_return = Math.pow(final_equity / initial_equity, 1 / yrs) - 1;
  } catch {}

  const price_series =
    Array.isArray(raw?.price_series) && raw.price_series.length
      ? raw.price_series
      : (raw?.preview ?? []).map((p: any) => ({ date: String(p.date ?? ""), close: n(p.close) }));

  return {
    symbol: String(raw?.symbol ?? ""),
    start, end,
    params: { threshold, hold_days },
    metrics: { total_pnl, win_rate, annualized_return, max_drawdown: maxDD(equity_curve), final_equity, initial_equity },
    trades, equity_curve, price_series,
    note: raw?.detail || raw?.note,
  };
}

api.interceptors.response.use(
  (r) => {
    const url = String(r?.config?.url || "");
    const sent = typeof r?.config?.data === "string" ? JSON.parse(r.config.data) : r?.config?.data;
    if (url.endsWith("/peek")) r.data = normalizePeek(r.data ?? {});
    if (url.endsWith("/backtest")) r.data = normalizeBacktest(r.data ?? {}, sent);
    return r;
  },
  (e) => Promise.reject(e)
);

/* ========== Types + UI helpers ========== */
type PeekResponse = {
  symbol: string; start: string; end: string;
  min_close: number; median_close: number; max_close: number;
  suggested_threshold: number; rows: number;
  preview: { date: string; open: number; high: number; low: number; close: number }[];
  note?: string;
};
type Trade = { entry_date: string; entry_price: number; exit_date: string; exit_price: number; pnl: number; return_pct: number; };
type BacktestResponse = {
  symbol: string; start: string; end: string;
  params: { threshold: number; hold_days: number };
  metrics: { total_pnl: number; win_rate: number; annualized_return: number; max_drawdown: number; final_equity: number; initial_equity: number };
  trades: Trade[]; equity_curve: { date: string; equity: number }[]; price_series?: { date: string; close: number }[]; note?: string;
};

const PRESETS = ["AAPL","MSFT","NVDA","AMZN","META","GOOGL","TSLA","SPY","QQQ","NFLX"];
const fmtDate = (iso: string) => new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",year:"numeric"}).format(new Date(iso));
const fmtMoney  = (v:number) => Number.isFinite(v) ? "$" + Math.round(v).toLocaleString() : "";
const fmtMoney2 = (v:number) => Number.isFinite(v) ? "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
const fmtPct1   = (v:number) => Number.isFinite(v) ? (v*100).toFixed(1) + "%" : "";
const fmtPct2   = (v:number) => Number.isFinite(v) ? (v*100).toFixed(2) + "%" : "";
const fmtSignedMoney2 = (v:number) => !Number.isFinite(v) ? "" : (v >= 0 ? "+" : "−") + Math.abs(v).toLocaleString(undefined,{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:2});

type ChartMode = "equity" | "price";
type SortKey = "entry_date" | "exit_date" | "pnl" | "return_pct" | "daysBars";

/* ========== Main App ========== */
export default function App() {
  // Blank symbol on load.
  const today = new Date();
  const yday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const ydayISO = yday.toISOString().slice(0,10);
  const startISO = new Date(yday.getFullYear(), yday.getMonth(), yday.getDate() - 120).toISOString().slice(0,10);

  const [symbol, setSymbol] = useState("");
  const [start, setStart]   = useState(startISO);
  const [end, setEnd]       = useState(ydayISO);
  const [threshold, setThreshold] = useState("");
  const [holdDays, setHoldDays]   = useState("4");

  const [peek, setPeek]     = useState<PeekResponse | null>(null);
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [peekBusy, setPeekBusy] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [mode, setMode]       = useState<ChartMode>("equity");
  const [sortKey, setSortKey] = useState<SortKey>("entry_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [tradeView, setTradeView] = useState<"cards" | "table">("cards");

  useEffect(() => { if (end > ydayISO) setEnd(ydayISO); }, [end, ydayISO]);

  const parseThreshold = () => threshold.trim() === "" ? null : (isFinite(+threshold) ? +threshold : null);
  const parseHoldDays  = () => holdDays.trim()  === "" ? null : (Number.isInteger(+holdDays) && +holdDays >= 1 ? +holdDays : null);
  const canPeek = symbol.trim().length > 0;

  const doPeek = async () => {
    setError(null); setResult(null); setPeekBusy(true); setLoading(true);
    try {
      const res = await api.post<PeekResponse>("/peek", { symbol, start, end });
      setPeek(res.data);
      if (isFinite(res.data?.suggested_threshold)) setThreshold(res.data.suggested_threshold.toFixed(2));
    } catch (e:any) { setError(e?.response?.data?.detail ?? e.message); setPeek(null); }
    finally { setPeekBusy(false); setLoading(false); }
  };

  const doBacktest = async () => {
    setError(null); setLoading(true); setResult(null);
    try {
      const thr = parseThreshold(); const hd = parseHoldDays();
      if (thr === null) throw new Error("Please enter a valid numeric threshold (try Peek).");
      if (hd  === null) throw new Error("Hold Days must be a whole number ≥ 1.");
      const res = await api.post<BacktestResponse>("/backtest", {symbol, start, end, threshold: thr, hold_days: hd});
      setResult(res.data);
    } catch (e:any) { setError(e?.response?.data?.detail ?? e.message); }
    finally { setLoading(false); }
  };

  const dateIndex = useMemo(() => {
    const m = new Map<string, number>();
    (result?.price_series ?? []).forEach((r, i) => m.set(r.date, i));
    return m;
  }, [result]);

  const tradesWithBars = useMemo(() => {
    const t = (result?.trades ?? []).map(tr => {
      const iE = dateIndex.get(tr.entry_date), iX = dateIndex.get(tr.exit_date);
      return { ...tr, daysBars: (iE !== undefined && iX !== undefined) ? Math.max(0, iX - iE) : NaN };
    });
    const dir = (sortDir === "asc") ? 1 : -1;
    return [...t].sort((a:any,b:any) => (["entry_date","exit_date"].includes(sortKey)
      ? (a[sortKey] < b[sortKey] ? -1 : a[sortKey] > b[sortKey] ? 1 : 0)
      : ((a as any)[sortKey] - (b as any)[sortKey])) * dir
    );
  }, [result, sortKey, sortDir, dateIndex]);

  const kpis = useMemo(() => {
    const count = tradesWithBars.length;
    const totalPnL = tradesWithBars.reduce((s,x)=>s+x.pnl,0);
    const wins = tradesWithBars.filter(x => x.pnl > 0);
    const winRate  = count ? wins.length / count : 0;
    const best = count ? Math.max(...tradesWithBars.map(x=>x.pnl)) : 0;
    const worst = count ? Math.min(...tradesWithBars.map(x=>x.pnl)) : 0;
    return { count, totalPnL, winRate, best, worst };
  }, [tradesWithBars]);

  const avgTradeReturn = useMemo(() => {
    const t = result?.trades ?? []; return t.length ? t.reduce((s,x)=>s+x.return_pct,0) / t.length : 0;
  }, [result]);

  const xTickFormatter = (iso: string) =>
    new Intl.DateTimeFormat("en-US",{year:"numeric",month:"2-digit"}).format(new Date(iso));
  const thrInvalid = threshold.trim() !== "" && parseThreshold() === null;
  const hdInvalid  = holdDays.trim() !== "" && parseHoldDays() === null;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d)=> d==="asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  return (
    <div className="min-h-screen">
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-950 to-black" />
        <div className="relative mx-auto max-w-6xl px-4 pt-10 pb-6">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-emerald-600 flex items-center justify-center font-black">$</div>
            <h1 className="text-4xl font-bold">SSMIF Backtest Visualizer</h1>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 pt-1 pb-10 space-y-8">
        {/* Peek & symbols */}
        <div className="card p-6 sm:p-7">
          <h3 className="text-2xl font-bold tracking-tight text-emerald-400">Peek &amp; Symbols</h3>
          <div className="text-xs text-slate-400 mt-1 mb-3">Pick a symbol, choose dates, and click Peek.</div>

          <div className="flex flex-wrap gap-2 mb-3">
            {PRESETS.map(sym => (
              <button key={sym} className={"chip " + (symbol === sym ? "active" : "")} onClick={()=>setSymbol(sym)} type="button">{sym}</button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <label className="text-sm">
              <div className="mb-1 text-slate-300">Symbol</div>
              <input className="input" value={symbol} onChange={e=>setSymbol(e.target.value.toUpperCase())} list="symbols" placeholder="e.g. AAPL"/>
              <datalist id="symbols">{PRESETS.map(s => <option key={s} value={s} />)}</datalist>
            </label>
            <label className="text-sm"><div className="mb-1 text-slate-300">Start</div><input className="input" type="date" value={start} onChange={e=>setStart(e.target.value)} max={ydayISO}/></label>
            <label className="text-sm"><div className="mb-1 text-slate-300">End</div><input className="input" type="date" value={end} onChange={e=>setEnd(e.target.value)} max={ydayISO}/></label>
          </div>

          <div className="flex flex-wrap gap-3 mt-4 items-center">
            <button className="btn-primary" onClick={doPeek} disabled={loading || peekBusy || !canPeek}>{peekBusy ? "Peeking…" : "Peek"}</button>
            {error && <span className="text-rose-400">Error: {error}</span>}
          </div>
        </div>

        {/* Peek snapshot */}
        {peek && (
          <div className="card p-8 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-2xl font-bold tracking-tight text-emerald-400">{peek.symbol} Market Snapshot</h3>
                {/* EXACT user-selected dates */}
                <div className="text-sm text-slate-400">{fmtDate(start)} – {fmtDate(end)}</div>
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

        {/* Strategy Parameters */}
        <div className="card p-6 sm:p-7">
          <h3 className="text-2xl font-bold tracking-tight text-emerald-400 mb-3">Strategy Parameters</h3>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 lg:col-span-2">
              <label className="text-sm">
                <div className="mb-1 text-slate-300">Threshold</div>
                <input className={"input " + (thrInvalid ? "ring-2 ring-rose-500" : "")} inputMode="decimal" step="any" value={threshold} onChange={e=>setThreshold(e.target.value)} placeholder="e.g. 185.75"/>
              </label>
              <label className="text-sm">
                <div className="mb-1 text-slate-300">Hold Days</div>
                <input className={"input " + (hdInvalid ? "ring-2 ring-rose-500" : "")} inputMode="numeric" pattern="[0-9]*" min={1} value={holdDays} onChange={e=>setHoldDays(e.target.value)} placeholder=">= 1"/>
              </label>
              <div className="sm:col-span-2 flex items-center gap-3">
                <button className="btn-primary" onClick={doBacktest} disabled={loading || !canPeek}>Run Backtest</button>
                {result?.trades?.length ? (
                  <button className="btn-ghost" onClick={()=>exportTradesCSV(tradesWithBars as any, `${result.symbol}_${result.start}_${result.end}_trades.csv`)}>Export CSV</button>
                ) : null}
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-[13px] leading-6">
              <div className="font-semibold text-slate-200 mb-1">How this strategy works</div>
              <ul className="list-disc ml-5 text-slate-300 space-y-1">
                <li><span className="font-medium">Threshold</span>: go long when the close crosses <strong>above</strong> this price.</li>
                <li><span className="font-medium">Hold Days</span>: hold for N trading days; exit at that day’s close.</li>
                <li>One position at a time; P&amp;L realized on exits and added to cash-only equity.</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Backtest Results */}
        {result && (
          <>
            <div className="grid lg:grid-cols-3 gap-8 items-stretch">
              <div className="card p-6 lg:col-span-2 flex flex-col">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-2xl font-bold tracking-tight text-emerald-400">Backtest Results</h3>
                  <div className="flex items-center gap-2 text-sm text-slate-400">
                    {/* EXACT user-selected dates */}
                    {fmtDate(start)} – {fmtDate(end)} • {result.symbol}
                    <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-1 ml-3">
                      <button className={"px-3 py-1 rounded-md " + (mode==="equity" ? "bg-emerald-600 text-white" : "text-slate-200")} onClick={()=>setMode("equity")}>Equity</button>
                      <button className={"px-3 py-1 rounded-md " + (mode==="price" ? "bg-emerald-600 text-white" : "text-slate-200")} onClick={()=>setMode("price")}>Price</button>
                    </div>
                  </div>
                </div>

                <div className="w-full h-[380px] mt-2">
                  <ResponsiveContainer>
                    {mode === "equity" ? (
                      <AreaChart data={result?.equity_curve ?? []} margin={{ left: 68, right: 16, top: 10, bottom: 38 }}>
                        <defs>
                          <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.32}/>
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0.03}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="rgba(148,163,184,0.15)" vertical={false}/>
                        <XAxis dataKey="date" tickMargin={12} stroke="#94a3b8" tickFormatter={(d)=>new Intl.DateTimeFormat("en-US",{year:"numeric",month:"2-digit"}).format(new Date(d))}>
                          <Label value="Date" position="bottom" offset={24} fill="#94a3b8" />
                        </XAxis>
                        <YAxis stroke="#94a3b8" tickFormatter={fmtMoney} tickMargin={10}>
                          <Label value="Equity ($)" angle={-90} position="insideLeft" offset={14} dx={-60} dy={30} fill="#94a3b8" />
                        </YAxis>
                        <Tooltip contentStyle={{ background:"#0f172a", border:"1px solid #1f2937", borderRadius:12 }} formatter={(v:any)=>[fmtMoney2(v as number),"Equity"]}/>
                        <Area type="monotone" dataKey="equity" stroke="#10b981" fill="url(#eqFill)" strokeWidth={2} />
                      </AreaChart>
                    ) : (
                      <LineChart data={result?.price_series ?? []} margin={{ left: 72, right: 16, top: 10, bottom: 38 }}>
                        <CartesianGrid stroke="rgba(148,163,184,0.15)" vertical={false}/>
                        <XAxis dataKey="date" tickMargin={12} stroke="#94a3b8" tickFormatter={xTickFormatter}>
                          <Label value="Date" position="bottom" offset={24} fill="#94a3b8" />
                        </XAxis>
                        <YAxis stroke="#94a3b8" tickFormatter={fmtMoney} tickMargin={10}>
                          <Label value="Price ($)" angle={-90} position="insideLeft" offset={14} dx={-20} fill="#94a3b8" />
                        </YAxis>
                        <Tooltip contentStyle={{ background:"#0f172a", border:"1px solid #1f2937", borderRadius:12 }} formatter={(v:any)=>[fmtMoney2(v as number),"Close"]}/>
                        <Line type="monotone" dataKey="close" stroke="#60a5fa" dot={false} strokeWidth={2}/>
                        <ReferenceLine y={Number(result?.params?.threshold ?? threshold) || undefined} stroke="#f59e0b" strokeDasharray="4 4" />
                        {(result?.trades ?? []).map((t,i)=>(
                          <g key={i}>
                            <ReferenceDot x={t.entry_date} y={t.entry_price} r={4} fill="#10b981" stroke="#064e3b" />
                            <ReferenceDot x={t.exit_date}  y={t.exit_price}  r={4} fill="#ef4444" stroke="#7f1d1d" />
                          </g>
                        ))}
                      </LineChart>
                    )}
                  </ResponsiveContainer>
                </div>

                <div className="grid sm:grid-cols-4 gap-4 mt-5">
                  <Stat label="Profit & Loss (USD)" value={fmtSignedMoney2(result.metrics.total_pnl)} />
                  <Stat label="Win Rate" value={fmtPct1(result.metrics.win_rate)} />
                  <Stat label="Annualized Return" value={fmtPct2(result.metrics.annualized_return)} />
                  <Stat label="Trades" value={String((result.trades ?? []).length)} />
                </div>
                <div className="grid sm:grid-cols-4 gap-4 mt-4">
                  <Stat label="Final Equity" value={fmtMoney2(result.metrics.final_equity)} />
                  <Stat label="Max Drawdown" value={fmtPct2(result.metrics.max_drawdown)} />
                  <Stat label="Average Trade Return" value={fmtPct2(avgTradeReturn)} />
                  <Stat label="Initial Equity" value={fmtMoney2(result.metrics.initial_equity)} />
                </div>

                <div className="mt-3 text-xs text-slate-400 italic">
                  Equity starts at {fmtMoney2(result.metrics.initial_equity)} and steps up/down only on exit days (one position at a time).
                </div>
              </div>

              {/* Trades + Optimizer */}
              <div className="flex flex-col h-full">
                <div className="card p-6 mb-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-2xl font-bold tracking-tight text-emerald-400">Trades ({tradesWithBars.length})</h3>
                    <div className="flex gap-2 text-xs text-slate-400">
                      <button className={"px-3 py-1 rounded-md border " + (tradeView === "cards" ? "bg-emerald-600 text-white border-emerald-600" : "border-slate-700 text-slate-300")} onClick={()=>setTradeView("cards")}>Cards</button>
                      <button className={"px-3 py-1 rounded-md border " + (tradeView === "table" ? "bg-emerald-600 text-white border-emerald-600" : "border-slate-700 text-slate-300")} onClick={()=>setTradeView("table")}>Table</button>
                    </div>
                  </div>

                  {tradeView === "cards" ? (
                    <div className="overflow-x-auto">
                      <div className="grid auto-cols-[210px] grid-flow-col gap-4">
                        {tradesWithBars.map((t, i) => {
                          const positive = t.pnl >= 0;
                          return (
                            <div key={i} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                              <div className="text-sm font-semibold text-slate-200 mb-2">{t.entry_date}</div>
                              <div className="text-sm text-slate-300 space-y-1">
                                <Row k="Entry Px" v={t.entry_price.toFixed(2)} />
                                <Row k="Exit Px"  v={t.exit_price.toFixed(2)} />
                                <Row k="PnL"  v={`${positive?"+":""}${t.pnl.toFixed(2)}`} tone={positive?"win":"loss"} />
                                <Row k="Return" v={`${(t.return_pct*100).toFixed(2)}%`} tone={positive?"win":"loss"} />
                                <Row k="Bars" v={Number.isFinite((t as any).daysBars) ? (t as any).daysBars : "-"} />
                                <div className="flex justify-end">
                                  <span className={"px-2 py-0.5 rounded-full text-xs " + (positive ? "bg-emerald-900/40 text-emerald-300" : "bg-rose-900/40 text-rose-300")}>{positive ? "Win" : "Loss"}</span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="table text-sm w-full">
                        <thead>
                          <tr>
                            <Th onClick={()=>toggleSort("entry_date")}>Date In {sortKey==="entry_date" ? (sortDir==="asc"?"^":"v"):""}</Th>
                            <Th onClick={()=>toggleSort("exit_date")}>Date Out {sortKey==="exit_date" ? (sortDir==="asc"?"^":"v"):""}</Th>
                            <Th>Entry</Th><Th>Exit</Th>
                            <Th onClick={()=>toggleSort("pnl")}>PnL {sortKey==="pnl" ? (sortDir==="asc"?"^":"v"):""}</Th>
                            <Th onClick={()=>toggleSort("return_pct")}>Return % {sortKey==="return_pct" ? (sortDir==="asc"?"^":"v"):""}</Th>
                            <Th onClick={()=>toggleSort("daysBars")}>Bars {sortKey==="daysBars" ? (sortDir==="asc"?"^":"v"):""}</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {tradesWithBars.map((t, i) => (
                            <tr key={i} className={t.pnl >= 0 ? "text-emerald-300" : "text-rose-300"}>
                              <td>{t.entry_date}</td><td>{t.exit_date}</td>
                              <td>{t.entry_price.toFixed(2)}</td><td>{t.exit_price.toFixed(2)}</td>
                              <td>{t.pnl.toFixed(2)}</td><td>{(t.return_pct * 100).toFixed(2)}%</td>
                              <td>{Number.isFinite((t as any).daysBars) ? (t as any).daysBars : "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Optimizer Insights */}
                {result && (
                  <OptimizerPanel
                    result={result}
                    trades={(tradesWithBars as any) as (Trade & { daysBars?: number })[]}
                  />
                )}
              </div>
            </div>

            <DrawdownChart equity={result.equity_curve} />
          </>
        )}

        <div className="text-center text-xs text-slate-500">Created by <span className="font-semibold">Aryan Rawat</span></div>
      </div>
    </div>
  );
}

/* ========== Small UI bits ========== */
function Stat({ label, value, sub }: { label:string; value:string; sub?:string }) {
  return (
    <div className="p-5 rounded-xl bg-slate-900/40 border border-slate-800">
      <div className="text-sm text-slate-400">{label}</div>
      <div className="text-2xl font-semibold tabular-nums whitespace-nowrap leading-snug">{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
    </div>
  );
}
function Row({k,v,tone}:{k:string;v:any;tone?:"win"|"loss"}) {
  const c = tone==="win"?"text-emerald-300":tone==="loss"?"text-rose-300":"text-slate-300";
  return <div className={`flex justify-between ${c}`}><span>{k}</span><span className="tabular-nums">{v}</span></div>;
}
function Th({children, onClick}:{children:any; onClick?:()=>void}) {
  return <th className={"cursor-pointer"} onClick={onClick}>{children}</th>;
}

/* ========== Optimizer Panel (fixed layout) ========== */
function OptimizerPanel({
  result,
  trades,
}: {
  result: BacktestResponse;
  trades: (Trade & { daysBars?: number })[];
}) {
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);

  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const sumWins = sum(wins.map((t) => t.pnl));
  const sumLossAbs = Math.abs(sum(losses.map((t) => t.pnl)));
  const profitFactor =
    sumLossAbs === 0 ? (sumWins > 0 ? Infinity : 0) : sumWins / sumLossAbs;

  const avgWin = wins.length ? sumWins / wins.length : 0;
  const avgLossAbs =
    losses.length ? Math.abs(sum(losses.map((t) => t.pnl)) / losses.length) : 0;
  const hitRate = trades.length ? wins.length / trades.length : 0;
  const expectancy = avgWin * hitRate - avgLossAbs * (1 - hitRate);

  const bars = trades
    .map((t) => t.daysBars)
    .filter((b) => Number.isFinite(b)) as number[];
  const avgBars = bars.length ? sum(bars) / bars.length : 0;
  const medBars = bars.length
    ? [...bars].sort((a, b) => a - b)[Math.floor(bars.length / 2)]
    : 0;

  const suggestions: string[] = [];
  if (trades.length < 5) suggestions.push("Few trades — widen date range or lower the threshold to collect more samples.");
  if (profitFactor < 1 && trades.length >= 5) suggestions.push("Profit factor < 1. Raise threshold or shorten hold days to cut losers faster.");
  if (profitFactor >= 1.3 && hitRate < 0.5) suggestions.push("Good profit factor with <50% win rate — reward/risk looks healthy; keep losers small.");
  if (expectancy <= 0 && trades.length >= 5) suggestions.push("Negative expectancy. Tune threshold & hold days (use Peek’s suggestion + small increments).");
  if (result.metrics.max_drawdown > 0.2) suggestions.push("Max drawdown > 20%. Add risk controls (smaller size, tighter exits, or a trend filter).");
  if (Math.abs(result.metrics.annualized_return) < 0.02 && trades.length >= 10) suggestions.push("Low annualized return. Try alternative hold days (2–5) or a simple 50D MA trend filter).");
  if (avgBars > Number(result.params.hold_days) + 0.5) suggestions.push("Average bars exceed configured hold — consider fixed-bar exits or verify date alignment.");
  if (!suggestions.length) suggestions.push("Metrics look balanced. Next step: forward-test and compare live vs. backtest.");

  return (
    <div className="card p-6 mt-0 flex-1 flex flex-col">
      <h3 className="text-2xl font-bold tracking-tight text-emerald-400 mb-4">
        Optimizer Insights
      </h3>

      {/* Clean, compact tiles that don't overlap */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MiniStat label="Profit Factor" value={Number.isFinite(profitFactor) ? profitFactor.toFixed(2) : "∞"} />
        <MiniStat label="Expectancy / Trade" value={fmtSignedMoney2(expectancy)} />
        <MiniStat label="Hit Rate" value={fmtPct2(hitRate)} />
        <MiniStat label="Avg Bars (Median)" value={`${avgBars.toFixed(1)} (${medBars})`} />
      </div>

      {/* Suggestions area */}
      <div className="mt-5 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="text-sm font-semibold text-slate-300 mb-2">Suggestions</div>
        <ul className="list-disc ml-5 text-slate-300 space-y-1">
          {suggestions.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 min-h-[78px] flex flex-col justify-center">
      <div className="text-[11px] text-slate-400 truncate">{label}</div>
      <div className="text-lg font-semibold tabular-nums leading-tight">
        {value}
      </div>
    </div>
  );
}
