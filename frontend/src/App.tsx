import { useMemo, useState, useEffect } from "react";
import axios from "axios";
const api = axios.create({
  baseURL: "/api",
  withCredentials: false,
  timeout: 20000,
});
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  LineChart, Line, ReferenceLine, ReferenceDot, Label
} from "recharts";
import "./index.css";

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

function Stat({ label, value, sub }: { label:string; value:string; sub?:string }) {
  return (
    <div className="p-5 rounded-xl bg-slate-900/40 border border-slate-800">
      <div className="text-sm text-slate-400">{label}</div>
      <div className="text-3xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
    </div>
  );
}

function Kpi({
  label, value, sub, tone, small=false
}: { label: string; value: string; sub?: string; tone?: "bull" | "bear" | "muted"; small?: boolean }) {
  const toneClass =
    tone === "bull" ? "text-emerald-300" :
    tone === "bear" ? "text-rose-300" :
    "text-slate-200";

  // Smaller size so long money values fit on one line
  const size = small ? "text-sm leading-5" : "text-2xl leading-7";

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 min-w-0 h-full">
      {/* keep label on ONE line */}
      <div className="text-[11px] text-slate-400 whitespace-nowrap">{label}</div>
      <div className={`${size} font-semibold tabular-nums ${toneClass} whitespace-nowrap`}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}


const PRESETS = ["AAPL","MSFT","NVDA","AMZN","META","GOOGL","TSLA","SPY","QQQ","NFLX"];
const fmtDate = (iso: string) => new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",year:"numeric"}).format(new Date(iso));
const fmtMoney  = (v:number) => Number.isFinite(v) ? "$" + v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "";
const fmtMoney2 = (v:number) => Number.isFinite(v) ? "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
const fmtSignedMoney2 = (v:number) => {
  if (!Number.isFinite(v)) return "";
  const sign = v >= 0 ? "+" : "−";
  return sign + Math.abs(v).toLocaleString(undefined, {
    style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2
  });
};

type ChartMode = "equity" | "price";
type SortKey = "entry_date" | "exit_date" | "pnl" | "return_pct" | "daysBars";

export default function App() {
  const today = new Date();
  const yday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const ydayISO = yday.toISOString().slice(0,10);
  const startDefault = new Date(yday); startDefault.setDate(yday.getDate()-120);
  const startISO = startDefault.toISOString().slice(0,10);

  const [symbol, setSymbol] = useState("SPY");
  const [start, setStart]   = useState(startISO);
  const [end, setEnd]       = useState(ydayISO);
  const [threshold, setThreshold] = useState<string>("");
  const [holdDays, setHoldDays]   = useState<string>("4");

  const [peek, setPeek]     = useState<PeekResponse | null>(null);
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [peekBusy, setPeekBusy] = useState(false);   // show activity on Peek
  const [error, setError]     = useState<string | null>(null);
  const [mode, setMode]       = useState<ChartMode>("equity");
  const [saved, setSaved]     = useState(false);

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

  const saveSettings = () => {
    const payload = { symbol, start, end, threshold: parseThreshold() ?? threshold, holdDays: parseHoldDays() ?? holdDays };
    localStorage.setItem("ssmif-settings", JSON.stringify(payload));
    setSaved(true);
    setTimeout(()=>setSaved(false), 1400);
  };

  // ---- API calls ----
  const doPeek = async () => {
    setError(null); setResult(null);
    setPeekBusy(true); setLoading(true);
    try {
      // IMPORTANT: use the preconfigured axios instance (api) and path WITHOUT /api prefix
      const res = await api.post<PeekResponse>("/peek", { symbol, start, end });
      setPeek(res.data);
      setThreshold(res.data.suggested_threshold.toFixed(2));
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

  // ------ trades + sorting helpers ------
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
    const wins     = t.reduce((s,x)=>s+(x.pnl>0?1:0),0);
    const winRate  = count ? wins/count : 0;
    const best     = count ? Math.max(...t.map(x=>x.pnl)) : 0;
    const worst    = count ? Math.min(...t.map(x=>x.pnl)) : 0;
    return { count, totalPnL, winRate, best, worst };
  }, [tradesWithBars]);

  // axis helpers
  const xTickFormatter = (iso: string) => {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("en-US",{year:"numeric", month:"2-digit"}).format(d);
  };

  // choose first / middle / last ticks so the end date is never missing
  const equityXTicks = useMemo(() => {
    const arr = result?.equity_curve ?? [];
    if (arr.length === 0) return [];
    const n = arr.length - 1;
    const candidates = Array.from(new Set([0, Math.max(0, Math.floor(n/2)), n]));
    return candidates.map(i => arr[i].date);
  }, [result]);

  const priceXTicks = useMemo(() => {
    const arr = result?.price_series ?? [];
    if (arr.length === 0) return [];
    const n = arr.length - 1;
    const candidates = Array.from(new Set([0, Math.max(0, Math.floor(n/2)), n]));
    return candidates.map(i => arr[i].date);
  }, [result]);

  const thrInvalid = threshold.trim() !== "" && parseThreshold() === null;
  const hdInvalid  = holdDays.trim() !== "" && parseHoldDays() === null;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d=>d==="asc"?"desc":"asc");
    else { setSortKey(key); setSortDir("asc"); }
  };
  const sortIndicator = (key: SortKey) => (sortKey !== key ? "" : (sortDir === "asc" ? "^" : "v"));

  return (
    <div className="min-h-screen">
      {/* Header (kept minimal) */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-950 to-black" />
        <div className="relative mx-auto max-w-6xl px-4 pt-10 pb-6">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-bull-600 flex items-center justify-center font-black">$</div>
            <h1 className="text-4xl font-bold">SSMIF Backtest Visualizer</h1>
          </div>
        </div>
      </div>

      {/* Body: apply a single consistent vertical rhythm with space-y-8 */}
      <div className="mx-auto max-w-6xl px-4 pt-1 pb-10 space-y-8">
        {/* Form card */}
        <div className="card p-6 sm:p-7">
          {/* Preset chips */}
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
            <label className="text-sm"><div className="mb-1 text-slate-300">Threshold</div><input className={"input " + (thrInvalid ? "ring-2 ring-bear-500" : "")} inputMode="decimal" step="any" value={threshold} onChange={e=>setThreshold(e.target.value)} placeholder="e.g. 185.75"/></label>
            <label className="text-sm"><div className="mb-1 text-slate-300">Hold Days</div><input className={"input " + (hdInvalid ? "ring-2 ring-bear-500" : "")} inputMode="numeric" pattern="[0-9]*" min={1} value={holdDays} onChange={e=>setHoldDays(e.target.value)} placeholder=">= 1"/></label>
          </div>

          <div className="mt-2 text-xs text-slate-400 italic">
            Data range: {fmtDate(start)} – {fmtDate(end)}. End date may be clamped to yesterday to avoid partial intraday data.
          </div>

          <div className="flex flex-wrap gap-3 mt-4">
            <button className="btn-primary" onClick={doPeek} disabled={loading || peekBusy}>
              {peekBusy ? "Peeking…" : "Peek"}
            </button>
            <button className="btn-ghost" onClick={doBacktest} disabled={loading}>Run Backtest</button>
            <button className="btn-ghost" onClick={saveSettings} disabled={loading}>Save Settings</button>
            {saved && <span className="px-2 py-1 rounded-md bg-emerald-900/50 text-emerald-300 text-xs">Saved ✓</span>}
            {error && <span className="text-bear-400">Error: {error}</span>}
          </div>
        </div>

        {/* Peek summary — spacing matches other cards due to parent space-y-8 */}
        {peek && (
          <div className="card p-8 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-2xl font-bold tracking-tight text-bull-400">{peek.symbol} Market Snapshot</h3>
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

        {/* Results */}
        {result && (
          <div className="grid lg:grid-cols-3 gap-8 items-stretch">
            {/* Chart card */}
            <div className="card p-6 lg:col-span-2 flex flex-col">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-2xl font-bold tracking-tight text-bull-400">Equity Curve</h3>
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  {fmtDate(result.start)} – {fmtDate(result.end)} • {result.symbol}
                  <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-1 ml-3">
                    <button className={"px-3 py-1 rounded-md " + (mode==="equity" ? "bg-bull-600 text-white" : "text-slate-200")} onClick={()=>setMode("equity")}>Equity</button>
                    <button className={"px-3 py-1 rounded-md " + (mode==="price" ? "bg-bull-600 text-white" : "text-slate-200")} onClick={()=>setMode("price")}>Price</button>
                  </div>
                </div>
              </div>

              {/* Centered chart; labels positioned cleanly */}
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
                      <XAxis dataKey="date" ticks={(() => {
                        const arr = result.equity_curve;
                        if (!arr.length) return [];
                        const n = arr.length - 1;
                        return [0, Math.max(0, Math.floor(n/2)), n].map(i => arr[i].date);
                      })()} tickMargin={12} tickFormatter={(d)=>new Intl.DateTimeFormat("en-US",{year:"numeric",month:"2-digit"}).format(new Date(d))} stroke="#94a3b8">
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
                      <XAxis dataKey="date" ticks={(() => {
                        const arr = result.price_series ?? [];
                        if (!arr.length) return [];
                        const n = arr.length - 1;
                        return [0, Math.max(0, Math.floor(n/2)), n].map(i => arr[i].date);
                      })()} tickMargin={12} tickFormatter={xTickFormatter} stroke="#94a3b8">
                        <Label value="Date" position="bottom" offset={24} fill="#94a3b8" />
                      </XAxis>
                      <YAxis stroke="#94a3b8" tickFormatter={fmtMoney} tickMargin={10}>
                        <Label value="Price ($)" angle={-90} position="insideLeft" offset={14} dx={-10} fill="#94a3b8" />
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

              {/* Metrics under the chart */}
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

            {/* Right column: Trades (scrolls) + Parameters; bottoms align */}
            <div className="flex flex-col h-full min-h-0">
              <div className="card p-6 flex-1 min-h-0 overflow-auto">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-2xl font-bold tracking-tight text-bull-400">Trades ({tradesWithBars.length})</h3>
                </div>

                <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3 mb-4">
                  <Kpi label="Best Trade"  value={fmtSignedMoney2(kpis.best)}  tone={kpis.best>=0 ? "bull" : "bear"} sub="USD" small />
                  <Kpi label="Worst Trade" value={fmtSignedMoney2(kpis.worst)} tone={kpis.worst>=0 ? "bull" : "bear"} sub="USD" small />
                  <Kpi label="Hold Period" value={(result?.params?.hold_days ?? Number(holdDays)).toString() + " days"} tone="muted" small />
                </div>

                <div className="max-h-full">
                  <table className="table table-auto w-full text-sm">
                    <thead className="sticky top-0 bg-slate-900/80 backdrop-blur">
                      <tr>
                        <th className="w-[18%] cursor-pointer" onClick={()=>toggleSort("entry_date")}>Entry {sortIndicator("entry_date")}</th>
                        <th className="w-[12%] text-right">Entry Px</th>
                        <th className="w-[18%] cursor-pointer" onClick={()=>toggleSort("exit_date")}>Exit {sortIndicator("exit_date")}</th>
                        <th className="w-[12%] text-right">Exit Px</th>
                        <th className="w-[12%] text-right cursor-pointer" onClick={()=>toggleSort("pnl")}>PnL {sortIndicator("pnl")}</th>
                        <th className="w-[10%] text-right cursor-pointer" onClick={()=>toggleSort("return_pct")}>% {sortIndicator("return_pct")}</th>
                        <th className="w-[8%]  text-right cursor-pointer" onClick={()=>toggleSort("daysBars")}>Bars {sortIndicator("daysBars")}</th>
                        <th className="w-[10%] text-right">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tradesWithBars.map((t, i) => {
                        const positive = t.pnl >= 0;
                        const money = (positive?"+":"") + t.pnl.toFixed(2);
                        const pct   = (positive?"+":"") + (t.return_pct*100).toFixed(2) + "%";
                        return (
                          <tr key={i} className="hover:bg-slate-900/50">
                            <td>{t.entry_date}</td>
                            <td className="text-right">{t.entry_price.toFixed(2)}</td>
                            <td>{t.exit_date}</td>
                            <td className="text-right">{t.exit_price.toFixed(2)}</td>
                            <td className={"text-right " + (positive ? "text-bull-400" : "text-bear-400")}>{money}</td>
                            <td className={"text-right " + (positive ? "text-bull-400" : "text-bear-400")}>{pct}</td>
                            <td className="text-right">{Number.isFinite((t as any).daysBars) ? (t as any).daysBars : "-"}</td>
                            <td className="text-right">
                              <span className={"px-2 py-0.5 rounded-full text-xs " + (positive ? "bg-emerald-900/40 text-emerald-300" : "bg-rose-900/40 text-rose-300")}>
                                {positive ? "Win" : "Loss"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-900/40">
                        <td className="font-semibold">Totals</td>
                        <td></td><td></td>
                        <td className="text-right font-semibold">Trades: {kpis.count}</td>
                        <td className="text-right font-semibold">{(kpis.totalPnL>=0?"+":"") + kpis.totalPnL.toFixed(2)}</td>
                        <td className="text-right font-semibold">{(kpis.winRate*100).toFixed(1)}%</td>
                        <td className="text-right font-semibold">—</td>
                        <td className="text-right font-semibold">{(kpis.winRate*100).toFixed(1)}%</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Parameters & Notes pinned under Trades */}
              <div className="card p-6 mt-6">
                <h3 className="text-2xl font-bold tracking-tight text-bull-400 mb-3">Parameters & Notes</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="text-slate-400">Symbol</div><div className="tabular-nums">{result.symbol}</div>
                  <div className="text-slate-400">Start</div><div className="tabular-nums">{fmtDate(result.start)}</div>
                  <div className="text-slate-400">End</div><div className="tabular-nums">{fmtDate(result.end)}</div>
                  <div className="text-slate-400">Threshold</div><div className="tabular-nums">{result.params.threshold.toFixed(2)}</div>
                  <div className="text-slate-400">Hold Days</div><div className="tabular-nums">{result.params.hold_days}</div>
                </div>
                {result.note && (
                  <div className="mt-3 p-3 rounded-lg bg-slate-900/50 border border-slate-800 text-sm text-slate-300">
                    {result.note}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="text-center text-xs text-slate-500">Created by <span className="font-semibold">Aryan Rawat</span></div>
      </div>
    </div>
  );
}
