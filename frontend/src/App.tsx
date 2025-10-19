import { useMemo, useState, useEffect } from "react";
import axios from "axios";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  LineChart, Line, ReferenceLine, ReferenceDot, Label
} from "recharts";
import "./index.css";

/* ========= AXIOS CLIENT (normalized responses) ========= */

const BASE = (import.meta as any).env?.VITE_API_BASE || "/api";

const api = axios.create({
  baseURL: BASE,
  timeout: 25000,
});

const n = (x: unknown, d = 2) => +((typeof x === "number" && isFinite(x) ? x : 0).toFixed(d));
const pick = <T,>(...cands: T[]) => {
  for (const c of cands) if (c !== undefined && c !== null) return c;
  return undefined as unknown as T;
};

function normalizePeek(raw: any) {
  const preview = Array.isArray(raw?.preview) ? raw.preview : [];

  const min_close = n(pick(raw?.stats?.min_close, raw?.min_close, raw?.minClose, 0));
  const median_close = n(pick(raw?.stats?.median_close, raw?.median_close, raw?.medianClose, 0));
  const max_close = n(pick(raw?.stats?.max_close, raw?.max_close, raw?.maxClose, 0));
  const suggested_threshold =
    +(
      pick(
        raw?.stats?.suggested_threshold,
        raw?.suggested_threshold,
        raw?.suggestedThreshold,
        0
      ) ?? 0
    ).toFixed(3);

  const rows =
    typeof raw?.rows === "number" ? raw.rows : Array.isArray(preview) ? preview.length : 0;

  const start =
    raw?.start ??
    (preview.length ? preview[0].date : "") ?? "";
  const end =
    raw?.end ??
    (preview.length ? preview[preview.length - 1].date : "") ?? "";

  const symbol = (raw?.symbol ?? "").toString();

  return {
    symbol,
    start,
    end,
    min_close,
    median_close,
    max_close,
    suggested_threshold,
    rows,
    preview,
    note: raw?.detail || raw?.note,
  };
}

function toDecimalPct(x: unknown) {
  const v = Number(x);
  if (!isFinite(v)) return 0;
  return Math.abs(v) > 1 ? v / 100 : v;
}

function computeMaxDrawdown(series: { equity: number }[]) {
  let peak = series.length ? series[0].equity : 0;
  let mdd = 0;
  for (const p of series) {
    if (p.equity > peak) peak = p.equity;
    const dd = peak ? (p.equity - peak) / peak : 0;
    if (dd < mdd) mdd = dd;
  }
  return Math.abs(mdd);
}

function normalizeBacktest(raw: any, reqBodyJson: any) {
  const tradesRaw = Array.isArray(raw?.trades) ? raw.trades : [];
  const equity_curve =
    Array.isArray(raw?.equity_curve)
      ? raw.equity_curve
      : Array.isArray(raw?.equityCurve)
      ? raw.equityCurve
      : [];

  const trades = tradesRaw.map((t: any) => ({
    entry_date: String(t.entry_date ?? ""),
    entry_price: n(t.entry_price),
    exit_date: String(t.exit_date ?? ""),
    exit_price: n(t.exit_price),
    pnl: n(t.pnl),
    return_pct: toDecimalPct(t.return_pct),
  }));

  let threshold = Number(reqBodyJson?.threshold);
  if (!isFinite(threshold)) {
    threshold = Number(pick(raw?.params?.threshold, raw?.threshold, 0));
  }
  const hold_days = Number.isFinite(Number(reqBodyJson?.hold_days))
    ? Number(reqBodyJson?.hold_days)
    : Number(pick(raw?.params?.hold_days, raw?.hold_days, 0));

  const initial_equity = n(pick(raw?.metrics?.initial_equity, raw?.equity_start, 1000));
  const final_equity = n(
    pick(
      raw?.metrics?.final_equity,
      raw?.equity_end,
      equity_curve.length ? equity_curve[equity_curve.length - 1].equity : initial_equity
    )
  );
  const total_pnl = n(final_equity - initial_equity);
  const win_rate =
    n(pick(raw?.metrics?.win_rate, raw?.win_rate_pct, 0), 4) / (raw?.metrics?.win_rate ? 1 : 100);

  const startStr = raw?.start ?? "";
  const endStr = raw?.end ?? "";
  let annualized_return = 0;
  try {
    const start = new Date(startStr);
    const end = new Date(endStr);
    const days = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    const years = days / 365;
    if (years > 0 && initial_equity > 0) {
      annualized_return = Math.pow(final_equity / initial_equity, 1 / years) - 1;
    }
  } catch {}

  const max_drawdown = computeMaxDrawdown(equity_curve);

  const price_series =
    Array.isArray(raw?.price_series) && raw.price_series.length
      ? raw.price_series
      : Array.isArray(raw?.preview)
      ? raw.preview.map((p: any) => ({ date: String(p.date ?? ""), close: n(p.close) }))
      : [];

  return {
    symbol: String(raw?.symbol ?? ""),
    start: startStr,
    end: endStr,
    params: { threshold, hold_days },
    metrics: {
      total_pnl,
      win_rate,
      annualized_return,
      max_drawdown,
      final_equity,
      initial_equity,
    },
    trades,
    equity_curve,
    price_series,
    note: raw?.detail || raw?.note,
  };
}

api.interceptors.response.use(
  (response) => {
    try {
      const url = String(response?.config?.url || "");
      let reqBodyJson: any = undefined;
      try {
        reqBodyJson =
          typeof response?.config?.data === "string"
            ? JSON.parse(response.config.data)
            : response?.config?.data;
      } catch {}
      if (url.endsWith("/peek")) {
        response.data = normalizePeek(response.data ?? {});
      } else if (url.endsWith("/backtest")) {
        response.data = normalizeBacktest(response.data ?? {}, reqBodyJson);
      }
    } catch (e) {
      console.error("[api] normalize failed:", e);
    }
    return response;
  },
  (err) => {
    const msg = err?.response?.data ?? err?.message ?? String(err);
    console.error("[api] error:", msg);
    return Promise.reject(err);
  }
);

try { console.info("[api] baseURL =", BASE); } catch {}

/* ========= TYPES ========= */

type PeekResponse = {
  symbol: string; start: string; end: string;
  min_close: number; median_close: number; max_close: number;
  suggested_threshold: number; rows: number;
  preview: { date: string; open: number; high: number; low: number; close: number }[];
  note?: string;
};

type Trade = {
  entry_date: string; entry_price: number;
  exit_date: string;  exit_price: number;
  pnl: number; return_pct: number;
};

type BacktestResponse = {
  symbol: string; start: string; end: string;
  params: { threshold: number; hold_days: number };
  metrics: {
    total_pnl: number; win_rate: number; annualized_return: number;
    max_drawdown: number; final_equity: number; initial_equity: number
  };
  trades: Trade[];
  equity_curve: { date: string; equity: number }[];
  price_series?: { date: string; close: number }[];
  note?: string;
};

/* ========= UI HELPERS ========= */

const PRESETS = ["AAPL","MSFT","NVDA","AMZN","META","GOOGL","TSLA","SPY","QQQ","NFLX"];
const fmtDate = (iso: string) => new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",year:"numeric"}).format(new Date(iso));
const fmtMoney  = (v:number) => Number.isFinite(v) ? "$" + Math.round(v).toLocaleString() : "";
const fmtMoney2 = (v:number) => Number.isFinite(v) ? "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
const fmtPct1   = (v:number) => Number.isFinite(v) ? (v*100).toFixed(1) + "%" : "";
const fmtPct2   = (v:number) => Number.isFinite(v) ? (v*100).toFixed(2) + "%" : "";
const fmtSignedMoney2 = (v:number) => {
  if (!Number.isFinite(v)) return "";
  const sign = v >= 0 ? "+" : "−";
  return sign + Math.abs(v).toLocaleString(undefined, { style:"currency", currency:"USD", minimumFractionDigits:2, maximumFractionDigits:2 });
};

type ChartMode = "equity" | "price";
type SortKey = "entry_date" | "exit_date" | "pnl" | "return_pct" | "daysBars";

/* ========================= APP ========================= */

export default function App() {
  const today = new Date();
  const yday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const ydayISO = yday.toISOString().slice(0,10);
  const startDefault = new Date(yday); startDefault.setDate(yday.getDate()-120);
  const startISO = startDefault.toISOString().slice(0,10);

  // CHANGE 1: no default symbol; keep your convenient default dates
  const [symbol, setSymbol] = useState<string>("");     // was "SPY"
  const [start, setStart]   = useState<string>(startISO);
  const [end, setEnd]       = useState<string>(ydayISO);
  const [threshold, setThreshold] = useState<string>("");
  const [holdDays, setHoldDays]   = useState<string>("4");

  const [peek, setPeek]     = useState<PeekResponse | null>(null);
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [peekBusy, setPeekBusy] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [mode, setMode]       = useState<ChartMode>("equity");

  const [sortKey, setSortKey] = useState<SortKey>("entry_date");
  const [sortDir, setSortDir] = useState<"asc"|"desc">("asc");

  useEffect(() => {
    try {
      const raw = localStorage.getItem("ssmif-settings");
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.symbol) setSymbol(String(s.symbol));
      if (s.start)  setStart(String(s.start));
      if (s.end)    setEnd(String(s.end));
      if (s.threshold !== undefined) setThreshold(String(s.threshold));
      if (s.holdDays  !== undefined) setHoldDays(String(s.holdDays));
    } catch {}
  }, []);

  useEffect(() => { if (end > ydayISO) setEnd(ydayISO); }, [end, ydayISO]);

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

  const canPeek = symbol.trim().length > 0;

  const doPeek = async () => {
    setError(null); setResult(null);
    setPeekBusy(true); setLoading(true);
    try {
      // CHANGE 2 (safe): you were already sending start/end; keep it unchanged
      const res = await api.post<PeekResponse>("/peek", { symbol, start, end });
      setPeek(res.data);
      if (Number.isFinite(res.data?.suggested_threshold)) {
        setThreshold(res.data.suggested_threshold.toFixed(2));
      }
    } catch (e:any) {
      setError(e?.response?.data?.detail ?? e.message);
      setPeek(null);
    } finally { setPeekBusy(false); setLoading(false); }
  };

  const doBacktest = async () => {
    setError(null); setLoading(true); setResult(null);
    try {
      const thr = parseThreshold();
      const hd  = parseHoldDays();
      if (thr === null) throw new Error("Please enter a valid numeric threshold (try Peek).");
      if (hd  === null) throw new Error("Hold Days must be a whole number >= 1.");
      const res = await api.post<BacktestResponse>("/backtest", {symbol, start, end, threshold: thr, hold_days: hd});
      setResult(res.data);
    } catch (e:any) {
      setError(e?.response?.data?.detail ?? e.message);
    } finally { setLoading(false); }
  };

  const dateIndex = useMemo(() => {
    const m = new Map<string, number>();
    (result?.price_series ?? []).forEach((r, i) => m.set(r.date, i));
    return m;
  }, [result]);

  const tradesWithBars = useMemo(() => {
    const t = (result?.trades ?? []).map(tr => {
      const iE = dateIndex.get(tr.entry_date);
      const iX = dateIndex.get(tr.exit_date);
      const bars = (iE !== undefined && iX !== undefined) ? Math.max(0, iX - iE) : NaN;
      return { ...tr, daysBars: bars };
    });
    const dir = (sortDir === "asc") ? 1 : -1;
    const sorted = [...t].sort((a:any,b:any) => {
      if (sortKey === "entry_date" || sortKey === "exit_date") {
        return (a[sortKey] < b[sortKey] ? -1 : a[sortKey] > b[sortKey] ? 1 : 0) * dir;
      }
      return ((a as any)[sortKey] - (b as any)[sortKey]) * dir;
    });
    return sorted;
  }, [result, sortKey, sortDir, dateIndex]);

  const kpis = useMemo(() => {
    const t = tradesWithBars;
    const count = t.length;
    const totalPnL = t.reduce((s,x)=>s+x.pnl,0);
    const wins     = t.filter(x => x.pnl > 0);
    const losses   = t.filter(x => x.pnl <= 0);
    const winRate  = count ? wins.length / count : 0;
    const best     = count ? Math.max(...t.map(x=>x.pnl)) : 0;
    const worst    = count ? Math.min(...t.map(x=>x.pnl)) : 0;
    return { count, totalPnL, winRate, best, worst };
  }, [tradesWithBars]);

  const avgTradeReturn = useMemo(() => {
    const t = result?.trades ?? [];
    if (!t.length) return 0;
    return t.reduce((s,x)=>s+x.return_pct,0) / t.length;
  }, [result]);

  const xTickFormatter = (iso: string) => {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("en-US",{year:"numeric", month:"2-digit"}).format(d);
  };

  const thrInvalid = threshold.trim() !== "" && parseThreshold() === null;
  const hdInvalid  = holdDays.trim() !== "" && parseHoldDays() === null;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d=>d==="asc"?"desc":"asc");
    else { setSortKey(key); setSortDir("asc"); }
  };
  const sortIndicator = (key: SortKey) => (sortKey !== key ? "" : (sortDir === "asc" ? "^" : "v"));

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-950 to-black" />
        <div className="relative mx-auto max-w-6xl px-4 pt-10 pb-6">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-bull-600 flex items-center justify-center font-black">$</div>
            <h1 className="text-4xl font-bold">SSMIF Backtest Visualizer</h1>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto max-w-6xl px-4 pt-1 pb-10 space-y-8">

        {/* Peek & symbols */}
        <div className="card p-6 sm:p-7">
          <h3 className="text-2xl font-bold tracking-tight text-bull-400">Peek &amp; Symbols</h3>
          <div className="text-xs text-slate-400 mt-1 mb-3">All symbols work — these are just popular ones.</div>

          <div className="flex flex-wrap gap-2 mb-3">
            {PRESETS.map(sym => (
              <button key={sym} className={"chip " + (symbol === sym ? "active" : "")} onClick={()=>setSymbol(sym)} type="button">
                {sym}
              </button>
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

          <div className="flex flex-wrap gap-3 mt-4">
            <button className="btn-primary" onClick={doPeek} disabled={loading || peekBusy || !canPeek}>
              {peekBusy ? "Peeking…" : "Peek"}
            </button>
            {error && <span className="text-bear-400">Error: {error}</span>}
          </div>
        </div>

        {/* Peek snapshot */}
        {peek && (
          <div className="card p-8 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-2xl font-bold tracking-tight text-bull-400">{peek.symbol} Market Snapshot</h3>
                {/* Keep your backend-provided dates exactly */}
                <div className="text-sm text-slate-400">{fmtDate(peek.start)} – {fmtDate(peek.end)}</div>
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
          <h3 className="text-2xl font-bold tracking-tight text-bull-400 mb-3">Strategy Parameters</h3>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 lg:col-span-2">
              <label className="text-sm">
                <div className="mb-1 text-slate-300">Threshold</div>
                <input className={"input " + (thrInvalid ? "ring-2 ring-bear-500" : "")} inputMode="decimal" step="any" value={threshold} onChange={e=>setThreshold(e.target.value)} placeholder="e.g. 185.75"/>
              </label>
              <label className="text-sm">
                <div className="mb-1 text-slate-300">Hold Days</div>
                <input className={"input " + (hdInvalid ? "ring-2 ring-bear-500" : "")} inputMode="numeric" pattern="[0-9]*" min={1} value={holdDays} onChange={e=>setHoldDays(e.target.value)} placeholder=">= 1"/>
              </label>
              <div className="sm:col-span-2">
                <button className="btn-primary" onClick={doBacktest} disabled={loading || !canPeek}>Run Backtest</button>
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
          <div className="grid lg:grid-cols-3 gap-8 items-stretch">
            <div className="card p-6 lg:col-span-2 flex flex-col">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-2xl font-bold tracking-tight text-bull-400">Backtest Results</h3>
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  {fmtDate(result.start)} – {fmtDate(result.end)} • {result.symbol}
                  <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-1 ml-3">
                    <button className={"px-3 py-1 rounded-md " + (mode==="equity" ? "bg-bull-600 text-white" : "text-slate-200")} onClick={()=>setMode("equity")}>Equity</button>
                    <button className={"px-3 py-1 rounded-md " + (mode==="price" ? "bg-bull-600 text-white" : "text-slate-200")} onClick={()=>setMode("price")}>Price</button>
                  </div>
                </div>
              </div>

              <div className="w-full h-[380px] mt-2">
                <ResponsiveContainer>
                  {mode === "equity" ? (
                    <AreaChart data={result.equity_curve} margin={{ left: 68, right: 16, top: 10, bottom: 38 }}>
                      <defs>
                        <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.32}/>
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0.03}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(148,163,184,0.15)" vertical={false}/>
                      <XAxis dataKey="date" tickMargin={12} tickFormatter={(d)=>new Intl.DateTimeFormat("en-US",{year:"numeric",month:"2-digit"}).format(new Date(d))} stroke="#94a3b8">
                        <Label value="Date" position="bottom" offset={24} fill="#94a3b8" />
                      </XAxis>
                      <YAxis stroke="#94a3b8" tickFormatter={fmtMoney} tickMargin={10}>
                        <Label value="Equity ($)" angle={-90} position="insideLeft" offset={14} dx={-60} dy={30} fill="#94a3b8" />
                      </YAxis>
                      <Tooltip contentStyle={{ background:"#0f172a", border:"1px solid #1f2937", borderRadius:12 }} formatter={(value:any) => [fmtMoney2(value as number), "Equity"]}/>
                      <Area type="monotone" dataKey="equity" stroke="#10b981" fill="url(#eqFill)" strokeWidth={2} />
                    </AreaChart>
                  ) : (
                    <LineChart data={result.price_series ?? []} margin={{ left: 72, right: 16, top: 10, bottom: 38 }}>
                      <CartesianGrid stroke="rgba(148,163,184,0.15)" vertical={false}/>
                      <XAxis dataKey="date" tickMargin={12} tickFormatter={xTickFormatter} stroke="#94a3b8">
                        <Label value="Date" position="bottom" offset={24} fill="#94a3b8" />
                      </XAxis>
                      <YAxis stroke="#94a3b8" tickFormatter={fmtMoney} tickMargin={10}>
                        <Label value="Price ($)" angle={-90} position="insideLeft" offset={14} dx={-20} fill="#94a3b8" />
                      </YAxis>
                      <Tooltip contentStyle={{ background:"#0f172a", border:"1px solid #1f2937", borderRadius:12 }} formatter={(value:any) => [fmtMoney2(value as number), "Close"]}/>
                      <Line type="monotone" dataKey="close" stroke="#60a5fa" dot={false} strokeWidth={2}/>
                      <ReferenceLine y={Number(result?.params?.threshold ?? threshold) || undefined} stroke="#f59e0b" strokeDasharray="4 4" />
                      {(result.trades ?? []).map((t, i) => (
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

            {/* Trades panel: CHANGE 3 – remove flex-grow/min-height so it doesn't leave empty space */}
            <div className="flex flex-col">
              <div className="card p-6">
                <div className="flex items-center justify-center mb-4">
                  <h3 className="text-2xl font-bold tracking-tight text-bull-400">Trades ({tradesWithBars.length})</h3>
                </div>

                <div className="flex flex-wrap justify-center gap-3 mb-5">
                  <Kpi label="Best Trade"  value={fmtSignedMoney2(kpis.best)}  tone={kpis.best>=0 ? "bull" : "bear"} sub="USD" />
                  <Kpi label="Worst Trade" value={fmtSignedMoney2(kpis.worst)} tone={kpis.worst>=0 ? "bull" : "bear"} sub="USD" />
                  <Kpi label="Hold Period" value={(result?.params?.hold_days ?? Number(holdDays)).toString() + " days"} tone="muted" />
                </div>

                <div className="overflow-x-auto">
                  <div className="grid auto-cols-[210px] grid-flow-col gap-4">
                    {tradesWithBars.map((t, i) => {
                      const positive = t.pnl >= 0;
                      return (
                        <div key={i} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                          <div className="text-sm font-semibold text-slate-200 mb-2">{t.entry_date}</div>
                          <div className="text-sm text-slate-300 space-y-1">
                            <div className="flex justify-between"><span>Entry Px</span><span className="tabular-nums">{t.entry_price.toFixed(2)}</span></div>
                            <div className="flex justify-between"><span>Exit Px</span><span className="tabular-nums">{t.exit_price.toFixed(2)}</span></div>
                            <div className={"flex justify-between " + (positive ? "text-emerald-300" : "text-rose-300")}>
                              <span>PnL</span><span className="tabular-nums">{(positive?"+":"") + t.pnl.toFixed(2)}</span>
                            </div>
                            <div className={"flex justify-between " + (positive ? "text-emerald-300" : "text-rose-300")}>
                              <span>Return</span><span className="tabular-nums">{(t.return_pct*100).toFixed(2)}%</span>
                            </div>
                            <div className="flex justify-between"><span>Bars</span><span className="tabular-nums">{Number.isFinite((t as any).daysBars) ? (t as any).daysBars : "-"}</span></div>
                            <div className="flex justify-end">
                              <span className={"px-2 py-0.5 rounded-full text-xs " + (positive ? "bg-emerald-900/40 text-emerald-300" : "bg-rose-900/40 text-rose-300")}>
                                {positive ? "Win" : "Loss"}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="text-center text-xs text-slate-500">Created by <span className="font-semibold">Aryan Rawat</span></div>
      </div>
    </div>
  );
}

/* -------------------- SMALL PRESENTATION COMPONENTS -------------------- */

function Stat({ label, value, sub }: { label:string; value:string; sub?:string }) {
  return (
    <div className="p-5 rounded-xl bg-slate-900/40 border border-slate-800">
      <div className="text-sm text-slate-400">{label}</div>
      <div className="text-2xl font-semibold tabular-nums whitespace-nowrap leading-snug">{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
    </div>
  );
}

function Kpi({
  label, value, sub, tone
}: { label: string; value: string; sub?: string; tone?: "bull" | "bear" | "muted" }) {
  const toneClass =
    tone === "bull" ? "text-emerald-300" :
    tone === "bear" ? "text-rose-300" :
    "text-slate-200";
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 w-[180px] text-center">
      <div className="text-[11px] text-slate-400 whitespace-nowrap">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${toneClass} whitespace-nowrap`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}
