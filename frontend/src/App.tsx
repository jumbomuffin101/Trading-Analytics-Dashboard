import { useMemo, useState, useEffect } from "react";
import axios from "axios";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  LineChart, Line, ReferenceLine, ReferenceDot, Label
} from "recharts";
import DrawdownChart from "./components/DrawdownChart";
import "./index.css";

/* ========== API + Normalizers ========== */
const BASE = (import.meta as any).env?.VITE_API_BASE || "/api";
const api = axios.create({ baseURL: BASE, timeout: 25000 });

const n = (x: unknown, d = 2) =>
  +((typeof x === "number" && isFinite(x) ? x : 0).toFixed(d));
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
    suggested_threshold: +n(
      pick(raw?.stats?.suggested_threshold, raw?.suggested_threshold, 0),
      3
    ),
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
  const equity_curve = Array.isArray(raw?.equity_curve)
    ? raw.equity_curve
    : (raw?.equityCurve ?? []);

  const trades = (raw?.trades ?? []).map((t: any) => ({
    entry_date: String(t.entry_date ?? ""),
    entry_price: n(t.entry_price),
    exit_date: String(t.exit_date ?? ""),
    exit_price: n(t.exit_price),
    pnl: n(t.pnl),
    return_pct: toPct(t.return_pct),
  }));

  const threshold = isFinite(+req?.threshold)
    ? +req.threshold
    : +pick(raw?.params?.threshold, raw?.threshold, 0);
  const hold_days = isFinite(+req?.hold_days)
    ? +req.hold_days
    : +pick(raw?.params?.hold_days, raw?.hold_days, 0);

  const initial_equity = n(pick(raw?.metrics?.initial_equity, raw?.equity_start, 1000));
  const lastEq = equity_curve.length ? equity_curve[equity_curve.length - 1].equity : initial_equity;
  const final_equity = n(pick(raw?.metrics?.final_equity, raw?.equity_end, lastEq));
  const total_pnl = n(final_equity - initial_equity);
  const win_rate = n(pick(raw?.metrics?.win_rate, raw?.win_rate_pct, 0), 4) / (raw?.metrics?.win_rate ? 1 : 100);

  const start = String(raw?.start ?? "");
  const end = String(raw?.end ?? "");
  let annualized_return = 0;
  try {
    const yrs = (new Date(end).getTime() - new Date(start).getTime()) / 86400000 / 365;
    if (yrs > 0 && initial_equity > 0) {
      annualized_return = Math.pow(final_equity / initial_equity, 1 / yrs) - 1;
    }
  } catch {}

  const price_series =
    Array.isArray(raw?.price_series) && raw.price_series.length
      ? raw.price_series
      : (raw?.preview ?? []).map((p: any) => ({
          date: String(p.date ?? ""),
          close: n(p.close),
        }));

  return {
    symbol: String(raw?.symbol ?? ""),
    start, end,
    params: { threshold, hold_days },
    metrics: {
      total_pnl,
      win_rate,
      annualized_return,
      max_drawdown: maxDD(equity_curve),
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
type Trade = {
  entry_date: string; entry_price: number;
  exit_date: string;  exit_price: number;
  pnl: number; return_pct: number;
};
type BacktestResponse = {
  symbol: string; start: string; end: string;
  params: { threshold: number; hold_days: number };
  metrics: { total_pnl: number; win_rate: number; annualized_return: number; max_drawdown: number; final_equity: number; initial_equity: number };
  trades: Trade[]; equity_curve: { date: string; equity: number }[]; price_series?: { date: string; close: number }[]; note?: string;
};

type StrategyKey = "breakout" | "sma_cross" | "mean_rev";

/* ===== Sample index (extend as you like) ===== */
const PRESETS = ["AAPL","MSFT","NVDA","AMZN","META","GOOGL","TSLA","SPY","QQQ","NFLX"];
const COMMON_SYMBOLS = [
  "AAPL","MSFT","NVDA","AMZN","META","GOOGL","TSLA","BRK.B","JPM","V","UNH","XOM","AVGO",
  "PG","LLY","MA","COST","HD","JNJ","MRK","ABBV","PEP","BAC","KO","PFE","DIS","WMT","CSCO",
  "ORCL","ADBE","CRM","NKE","AMD","NFLX","QCOM","INTC","TXN","AMAT","T","VZ","IBM","GE",
  "BA","CAT","MCD","SBUX","LOW","CVX","SPY","QQQ","DIA","IWM","GLD","SLV","TLT","^GSPC","^NDX"
];

/* ===== Formatting ===== */
const fmtDate = (iso: string) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(dt);
};
const fmtMoney  = (v:number) => Number.isFinite(v) ? "$" + Math.round(v).toLocaleString() : "";
const fmtMoney2 = (v:number) => Number.isFinite(v) ? "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
const fmtPct1   = (v:number) => Number.isFinite(v) ? (v*100).toFixed(1) + "%" : "";
const fmtPct2   = (v:number) => Number.isFinite(v) ? (v*100).toFixed(2) + "%" : "";
const fmtSignedMoney2 = (v:number) =>
  !Number.isFinite(v) ? "" : (v >= 0 ? "+" : "−") +
  Math.abs(v).toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

type ChartMode = "equity" | "price";
type SortKey = "entry_date" | "exit_date" | "pnl" | "return_pct" | "daysBars";

/* ========== Terminal palette ========== */
const PALETTE = {
  grid: "var(--grid)",
  axis: "var(--muted)",
  tooltipBg: "var(--panel)",
  tooltipBorder: "var(--border)",
  text: "var(--text)",
  priceLine: "var(--cyan)",
  equityLine: "#F5C400", // Bloomberg-ish yellow
  equityFill: "rgba(245,196,0,0.14)",
  up: "var(--up)",
  down: "var(--down)",
  threshold: "var(--accent)",
};

/* ======= Small UI helpers ======= */
function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin inline-block align-[-2px]">
      <circle cx="12" cy="12" r="10" stroke="var(--border)" strokeWidth="4" fill="none" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="var(--accent)" strokeWidth="4" fill="none" strokeLinecap="round" />
    </svg>
  );
}
function ErrorBanner({ msg, onClose }: { msg: string; onClose?: () => void }) {
  return (
    <div className="rounded-lg border border-[var(--down)]/50 bg-[var(--down)]/10 text-down px-3 py-2 flex items-start justify-between">
      <div className="text-sm">{msg}</div>
      {onClose && (
        <button onClick={onClose} className="ml-3 text-xs underline decoration-[var(--down)]/60 hover:opacity-80">
          dismiss
        </button>
      )}
    </div>
  );
}
function SkeletonCard() {
  return (
    <div className="p-6 rounded-xl border border-[var(--border)] bg-[var(--panel)]">
      <div className="h-5 w-40 bg-[var(--border)]/60 rounded mb-4" />
      <div className="h-[260px] w-full bg-[var(--border)]/40 rounded" />
    </div>
  );
}

/* ======= Tab labels ======= */
type AppTab = "docs" | "peek" | "strategy" | "results" | "trades" | "drawdown";

/* ========== Main App ========== */
export default function App() {
  const today = new Date();
  const yday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const ydayISO = yday.toISOString().slice(0,10);
  const startISO = new Date(yday.getFullYear(), yday.getMonth(), yday.getDate() - 120).toISOString().slice(0,10);

  const [active, setActive] = useState<AppTab>("docs");

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

  // strategy selector + params
  const [strategy, setStrategy] = useState<StrategyKey>("breakout");
  const [fast, setFast] = useState("10");
  const [slow, setSlow] = useState("30");
  const [revDropPct, setRevDropPct] = useState("2.0");

  // ----- date guards -----
  const onStartChange = (v: string) => {
    setStart(v);
    if (v > end) setEnd(v);
  };
  const onEndChange = (v: string) => {
    setEnd(v);
    if (v < start) setStart(v);
  };

  // reset results when symbol changes
  useEffect(() => {
    setPeek(null);
    setResult(null);
    setError(null);
  }, [symbol]);

  useEffect(() => { if (end > ydayISO) setEnd(ydayISO); }, [end, ydayISO]);

  const parseThreshold = () => {
    const s = threshold.trim();
    if (!s) return null;
    const v = Number(s);
    return isFinite(v) ? v : null;
  };
  const parseHoldDays = () => {
    const s = holdDays.trim();
    if (!s) return null;
    const v = parseInt(s, 10);
    return Number.isFinite(v) && v >= 1 ? v : null;
  };

  const canPeek = symbol.trim().length > 0;

  const doPeek = async () => {
    setError(null); setResult(null); setPeekBusy(true); setLoading(true);
    try {
      const res = await api.post<PeekResponse>("/peek", { symbol, start, end });
      setPeek(res.data);
      if (isFinite(res.data?.suggested_threshold)) {
        setThreshold(res.data.suggested_threshold.toFixed(2));
      }
      setActive("strategy");
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? e.message);
      setPeek(null);
    } finally {
      setPeekBusy(false);
      setLoading(false);
    }
  };

  const doBacktest = async () => {
    setError(null); setLoading(true); setResult(null);
    try {
      const thr = parseThreshold();
      const hd = parseHoldDays();
      if (strategy === "breakout") {
        if (thr === null) throw new Error("Please enter a valid numeric threshold (try Peek).");
        if (hd  === null) throw new Error("Hold Days must be a whole number >= 1.");
      }
      const payload: any = {
        symbol, start, end,
        threshold: thr, hold_days: hd, // compatibility
        strategy,
        params:
          strategy === "breakout"
            ? { threshold: thr, hold_days: hd }
            : strategy === "sma_cross"
            ? { fast: Number(fast), slow: Number(slow) }
            : { drop_pct: Number(revDropPct), hold_days: hd },
      };
      const res = await api.post<BacktestResponse>("/backtest", payload);
      setResult(res.data);
      setActive("results");
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? e.message);
    } finally {
      setLoading(false);
    }
  };

  const dateIndex = useMemo(() => {
    const m = new Map<string, number>();
    (result?.price_series ?? []).forEach((r, i) => m.set(r.date, i));
    return m;
  }, [result]);

  const tradesWithBars = useMemo(() => {
    const t = (result?.trades ?? []).map((tr) => {
      const iE = dateIndex.get(tr.entry_date);
      const iX = dateIndex.get(tr.exit_date);
      const bars = iE !== undefined && iX !== undefined ? Math.max(0, iX - iE) : NaN;
      return { ...tr, daysBars: bars };
    });
    const dir = sortDir === "asc" ? 1 : -1;
    return [...t].sort((a: any, b: any) => {
      if (sortKey === "entry_date" || sortKey === "exit_date") {
        return (a[sortKey] < b[sortKey] ? -1 : a[sortKey] > b[sortKey] ? 1 : 0) * dir;
      }
      return ((a as any)[sortKey] - (b as any)[sortKey]) * dir;
    });
  }, [result, sortKey, sortDir, dateIndex]);

  const avgTradeReturn = useMemo(() => {
    const t = result?.trades ?? [];
    return t.length ? t.reduce((s, x) => s + x.return_pct, 0) / t.length : 0;
  }, [result]);

  const xTickFormatter = (iso: string) =>
    new Intl.DateTimeFormat("en-US", { year: "numeric", month: "2-digit" }).format(new Date(iso));

  const thrInvalid = threshold.trim() !== "" && parseThreshold() === null;
  const hdInvalid  = holdDays.trim() !== "" && parseHoldDays() === null;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  // ------- drawdown fallback: never empty -------
  const safeEquityCurve =
    (result?.equity_curve?.length ?? 0) > 1
      ? result!.equity_curve
      : result
      ? [
          { date: result.start || start, equity: result.metrics.initial_equity ?? 1000 },
          { date: result.end || end, equity: result.metrics.final_equity ?? result.metrics.initial_equity ?? 1000 },
        ]
      : [];

  /* ===================== UI ===================== */
  return (
    <div className="theme-terminal">
      <div className="page-root min-h-screen bg-[var(--bg)] text-[var(--text)]">
        <div className="relative overflow-hidden">
          <div className="relative mx-auto max-w-6xl px-4 pt-10 pb-6">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl bg-[var(--accent)] text-[#0b0c10] flex items-center justify-center font-black">
                $
              </div>
              <h1 className="text-4xl font-bold">Signal Studio — Backtest Workbench</h1>
            </div>
          </div>
        </div>

        {/* Top tabs: no page scrolling needed */}
        <div className="sticky top-0 z-20 bg-[var(--bg)]/90 backdrop-blur border-b border-[var(--border)]">
          <div className="mx-auto max-w-6xl px-4 py-2 flex flex-wrap gap-2">
            {[
              {id:"docs",label:"Docs"},
              {id:"peek",label:"Peek"},
              {id:"strategy",label:"Strategy"},
              {id:"results",label:"Results"},
              {id:"trades",label:"Trades"},
              {id:"drawdown",label:"Drawdown"},
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setActive(t.id as AppTab)}
                className={
                  "px-3 py-1.5 rounded-full text-sm transition border " +
                  (active===t.id
                    ? "bg-[var(--accent)] text-[#0b0c10] border-[var(--accent)] shadow-[0_0_0_2px_rgba(245,196,0,0.2)]"
                    : "bg-[var(--panel)] text-[var(--text)] border-[var(--border)] hover:border-[var(--accent)]")
                }
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mx-auto max-w-6xl px-4 pt-6 pb-10">
          {/* ===== DOCS TAB ===== */}
          {active === "docs" && (
            <div className="card p-6 sm:p-7">
              <h3 className="text-2xl font-bold tracking-tight text-[var(--accent)]">Documentation</h3>
              <ul className="mt-3 text-sm text-[var(--text)]/80 leading-6 list-disc pl-5 space-y-1">
                <li><strong>Pick a symbol & dates:</strong> presets on top; Start is always ≤ End (auto-corrected).</li>
                <li><strong>Peek:</strong> previews the data range and suggests a threshold (75th percentile of closes).</li>
                <li><strong>Strategy:</strong> choose Breakout, SMA Crossover, or Mean Reversion and fill parameters.</li>
                <li><strong>Backtest:</strong> equity is cash-only and steps on exit days; price chart shows entries/exits.</li>
                <li><strong>Read tiles fast:</strong> positive/“good” values are <span className="text-up font-medium">green</span>; adverse values are <span className="text-down font-medium">red</span>.</li>
                <li><strong>Optimizer:</strong> strategy-aware suggestions and simple parameter sweeps to try next.</li>
                <li><strong>Assumptions:</strong> daily closes; no fees/slippage/leverage; one position at a time.</li>
              </ul>
            </div>
          )}

          {/* ===== PEEK TAB ===== */}
          {active === "peek" && (
            <div className="card p-6 sm:p-7">
              <h3 className="text-2xl font-bold tracking-tight text-[var(--accent)]">Peek &amp; Symbols</h3>
              <div className="text-xs text-[var(--muted)] mt-1 mb-3">Type or pick a symbol, choose dates, and click Peek.</div>

              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                {/* left: controls */}
                <div className="lg:col-span-3">
                  <div className="flex flex-wrap gap-2 mb-3">
                    {PRESETS.map((sym) => (
                      <button
                        key={sym}
                        className={"chip " + (symbol === sym ? "active" : "")}
                        onClick={() => setSymbol(sym)}
                        type="button"
                      >
                        {sym}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <label className="text-sm">
                      <div className="mb-1 text-[var(--text)]/80">Symbol</div>
                      <input
                        className="input"
                        value={symbol}
                        onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                        list="symbols"
                        placeholder="e.g. AAPL"
                      />
                      <datalist id="symbols">{PRESETS.map((s) => <option key={s} value={s} />)}</datalist>
                    </label>
                    <label className="text-sm">
                      <div className="mb-1 text-[var(--text)]/80">Start</div>
                      <input className="input" type="date" value={start} onChange={(e) => onStartChange(e.target.value)} max={ydayISO} />
                    </label>
                    <label className="text-sm">
                      <div className="mb-1 text-[var(--text)]/80">End</div>
                      <input className="input" type="date" value={end} onChange={(e) => onEndChange(e.target.value)} max={ydayISO} />
                    </label>
                  </div>

                  <div className="flex flex-wrap gap-3 mt-4 items-center">
                    <button className="btn-accent px-3 py-2 rounded-lg text-sm font-medium" onClick={doPeek} disabled={loading || peekBusy || !canPeek}>
                      {peekBusy ? (<><Spinner /><span className="ml-2">Peeking…</span></>) : "Peek"}
                    </button>
                  </div>

                  {error && <div className="mt-3"><ErrorBanner msg={error} onClose={()=>setError(null)} /></div>}
                  {peekBusy && !peek && <div className="mt-4"><SkeletonCard /></div>}

                  {peek && (
                    <div className="mt-6 space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-xl font-semibold text-[var(--accent)]">{peek.symbol} Market Snapshot</h4>
                          <div className="text-sm text-[var(--muted)]">
                            {start && end ? `${fmtDate(start)} – ${fmtDate(end)}` : "—"}
                            {(peek.start && peek.end) && (peek.start !== start || peek.end !== end) && (
                              <span className="ml-2 text-xs text-[var(--muted)]/70">
                                (data span {fmtDate(peek.start)} – {fmtDate(peek.end)})
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-sm text-[var(--muted)]">Rows: {peek.rows}</div>
                      </div>
                      <div className="grid sm:grid-cols-4 gap-4">
                        <Stat label="Min Close" value={peek.min_close.toFixed(2)} />
                        <Stat label="Median Close" value={peek.median_close.toFixed(2)} />
                        <Stat label="Max Close" value={peek.max_close.toFixed(2)} />
                        <Stat label="Suggested Threshold" value={peek.suggested_threshold.toFixed(2)} sub="75th percentile" />
                      </div>
                    </div>
                  )}
                </div>

                {/* right: Symbol Index */}
                <div className="lg:col-span-2">
                  <SymbolIndex
                    list={COMMON_SYMBOLS}
                    current={symbol}
                    onPick={(s) => setSymbol(s)}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ===== STRATEGY TAB ===== */}
          {active === "strategy" && (
            <div className="card p-6 sm:p-7">
              <h3 className="text-2xl font-bold tracking-tight text-[var(--accent)] mb-3">Strategy & Parameters</h3>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 lg:col-span-2">
                  <label className="text-sm sm:col-span-2">
                    <div className="mb-1 text-[var(--text)]/80">Strategy</div>
                    <select
                      className="input"
                      value={strategy}
                      onChange={(e) => setStrategy(e.target.value as StrategyKey)}
                    >
                      <option value="breakout">Breakout (threshold)</option>
                      <option value="sma_cross">SMA Crossover</option>
                      <option value="mean_rev">Mean Reversion</option>
                    </select>
                  </label>

                  {strategy === "breakout" && (
                    <>
                      <label className="text-sm">
                        <div className="mb-1 text-[var(--text)]/80">Threshold</div>
                        <input
                          className={"input " + (thrInvalid ? "ring-2 ring-[var(--down)]" : "")}
                          inputMode="decimal"
                          step="any"
                          value={threshold}
                          onChange={(e) => setThreshold(e.target.value)}
                          placeholder="e.g. 185.75"
                        />
                      </label>
                      <label className="text-sm">
                        <div className="mb-1 text-[var(--text)]/80">Hold Days</div>
                        <input
                          className={"input " + (hdInvalid ? "ring-2 ring-[var(--down)]" : "")}
                          inputMode="numeric"
                          pattern="[0-9]*"
                          min={1}
                          value={holdDays}
                          onChange={(e) => setHoldDays(e.target.value)}
                          placeholder=">= 1"
                        />
                      </label>
                    </>
                  )}

                  {strategy === "sma_cross" && (
                    <>
                      <label className="text-sm">
                        <div className="mb-1 text-[var(--text)]/80">Fast SMA</div>
                        <input className="input" inputMode="numeric" value={fast} onChange={(e)=>setFast(e.target.value)} placeholder="e.g. 10" />
                      </label>
                      <label className="text-sm">
                        <div className="mb-1 text-[var(--text)]/80">Slow SMA</div>
                        <input className="input" inputMode="numeric" value={slow} onChange={(e)=>setSlow(e.target.value)} placeholder="e.g. 30" />
                      </label>
                    </>
                  )}

                  {strategy === "mean_rev" && (
                    <>
                      <label className="text-sm">
                        <div className="mb-1 text-[var(--text)]/80">Drop % (from recent close)</div>
                        <input className="input" inputMode="decimal" step="any" value={revDropPct} onChange={(e)=>setRevDropPct(e.target.value)} placeholder="e.g. 2.0" />
                      </label>
                      <label className="text-sm">
                        <div className="mb-1 text-[var(--text)]/80">Hold Days</div>
                        <input className="input" inputMode="numeric" pattern="[0-9]*" min={1} value={holdDays} onChange={(e)=>setHoldDays(e.target.value)} placeholder=">= 1" />
                      </label>
                    </>
                  )}

                  <div className="sm:col-span-2 flex items-center gap-3">
                    <button className="btn-accent px-3 py-2 rounded-lg text-sm font-medium" onClick={doBacktest} disabled={loading || !canPeek}>
                      {loading ? (<><Spinner /><span className="ml-2">Running…</span></>) : "Run Backtest"}
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 text-[13px] leading-6">
                  <div className="font-semibold text-[var(--text)] mb-1">How this works</div>
                  <ul className="list-disc ml-5 text-[var(--text)]/80 space-y-1">
                    {strategy === "breakout" && (
                      <>
                        <li>Enter long on first close above <strong>Threshold</strong>; exit after N days.</li>
                        <li>One position at a time; P&amp;L realized on exits.</li>
                      </>
                    )}
                    {strategy === "sma_cross" && (
                      <>
                        <li>Enter long when <strong>Fast SMA</strong> crosses above <strong>Slow SMA</strong>.</li>
                        <li>Exit on reverse cross (or fixed horizon if modeled by backend).</li>
                      </>
                    )}
                    {strategy === "mean_rev" && (
                      <>
                        <li>Enter long after a drop of at least <strong>Drop %</strong> from recent close.</li>
                        <li>Exit after N days.</li>
                      </>
                    )}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* ===== RESULTS TAB ===== */}
          {active === "results" && result && (
            <div className="grid lg:grid-cols-3 gap-8 items-stretch">
              <div className="card p-6 lg:col-span-2 flex flex-col relative">
                {loading && (
                  <div className="absolute inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center rounded-xl z-10">
                    <div className="px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--panel)] text-sm">
                      <Spinner /> <span className="ml-2">Crunching numbers…</span>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-2xl font-bold tracking-tight text-[var(--accent)]">Backtest Results</h3>
                  <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
                    {fmtDate(start)} – {fmtDate(end)} • {result.symbol}
                    <div className="bg-[var(--panel)] border border-[var(--border)] rounded-lg p-1 ml-3">
                      <button
                        className={
                          "px-3 py-1 rounded-md border " +
                          (mode === "equity"
                            ? "bg-[var(--accent)] text-[#0b0c10] border-[var(--accent)]"
                            : "bg-transparent text-[var(--text)] border-[var(--border)]")
                        }
                        onClick={() => setMode("equity")}
                      >
                        Equity
                      </button>
                      <button
                        className={
                          "px-3 py-1 rounded-md border ml-1 " +
                          (mode === "price"
                            ? "bg-[var(--accent)] text-[#0b0c10] border-[var(--accent)]"
                            : "bg-transparent text-[var(--text)] border-[var(--border)]")
                        }
                        onClick={() => setMode("price")}
                      >
                        Price
                      </button>
                    </div>
                  </div>

                  <div className="w-full h-[380px] mt-2">
                    <ResponsiveContainer>
                      {mode === "equity" ? (
                        <AreaChart data={result?.equity_curve ?? []} margin={{ left: 68, right: 16, top: 10, bottom: 38 }}>
                          <defs>
                            <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={PALETTE.equityLine} stopOpacity={0.28} />
                              <stop offset="95%" stopColor={PALETTE.equityLine} stopOpacity={0.04} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid stroke={PALETTE.grid} vertical={false} />
                          <XAxis dataKey="date" tickMargin={12} stroke={PALETTE.axis} tickFormatter={(d) => new Intl.DateTimeFormat("en-US", { year: "numeric", month: "2-digit" }).format(new Date(d))}>
                            <Label value="Date" position="bottom" offset={24} fill={PALETTE.axis} />
                          </XAxis>
                          <YAxis stroke={PALETTE.axis} tickFormatter={fmtMoney} tickMargin={10}>
                            <Label value="Equity ($)" angle={-90} position="insideLeft" offset={14} dx={-60} dy={30} fill={PALETTE.axis} />
                          </YAxis>
                          <Tooltip
                            contentStyle={{
                              background: "var(--panel)",
                              border: "1px solid var(--border)",
                              borderRadius: 12,
                              color: "var(--text)",
                            }}
                            formatter={(v: any) => [fmtMoney2(v as number), "Equity"]}
                          />
                          <Area type="monotone" dataKey="equity" stroke={PALETTE.equityLine} fill="url(#eqFill)" strokeWidth={2} />
                        </AreaChart>
                      ) : (
                        <LineChart data={result?.price_series ?? []} margin={{ left: 72, right: 16, top: 10, bottom: 38 }}>
                          <CartesianGrid stroke={PALETTE.grid} vertical={false} />
                          <XAxis dataKey="date" tickMargin={12} stroke={PALETTE.axis} tickFormatter={xTickFormatter}>
                            <Label value="Date" position="bottom" offset={24} fill={PALETTE.axis} />
                          </XAxis>
                          <YAxis stroke={PALETTE.axis} tickFormatter={fmtMoney} tickMargin={10}>
                            <Label value="Price ($)" angle={-90} position="insideLeft" offset={14} dx={-20} fill={PALETTE.axis} />
                          </YAxis>
                          <Tooltip
                            contentStyle={{
                              background: "var(--panel)",
                              border: "1px solid var(--border)",
                              borderRadius: 12,
                              color: "var(--text)",
                            }}
                            formatter={(v: any) => [fmtMoney2(v as number), "Close"]}
                          />
                          <Line type="monotone" dataKey="close" stroke={PALETTE.priceLine} dot={false} strokeWidth={2} />
                          <ReferenceLine y={Number(result?.params?.threshold ?? threshold) || undefined} stroke={PALETTE.threshold} strokeDasharray="4 4" />
                          {(result?.trades ?? []).map((t, i) => (
                            <g key={i}>
                              <ReferenceDot x={t.entry_date} y={t.entry_price} r={4} fill={PALETTE.up} stroke="rgba(0,0,0,0.5)" />
                              <ReferenceDot x={t.exit_date} y={t.exit_price} r={4} fill={PALETTE.down} stroke="rgba(0,0,0,0.5)" />
                            </g>
                          ))}
                        </LineChart>
                      )}
                    </ResponsiveContainer>
                  </div>

                  <div className="grid sm:grid-cols-4 gap-4 mt-5">
                    <Stat label="Profit & Loss (USD)" value={fmtSignedMoney2(result.metrics.total_pnl)} numeric={result.metrics.total_pnl} tint />
                    <Stat label="Annualized Return" value={fmtPct2(result.metrics.annualized_return)} numeric={result.metrics.annualized_return} tint />
                    <Stat label="Average Trade Return" value={fmtPct2(avgTradeReturn)} numeric={avgTradeReturn} tint />
                    <Stat label="Max Drawdown" value={fmtPct2(result.metrics.max_drawdown)} numeric={-result.metrics.max_drawdown} tint />
                  </div>

                  <div className="grid sm:grid-cols-4 gap-4 mt-4">
                    <Stat label="Final Equity" value={fmtMoney2(result.metrics.final_equity)} />
                    <Stat label="Win Rate" value={fmtPct1(result.metrics.win_rate)} />
                    <Stat label="Trades" value={String((result.trades ?? []).length)} />
                    <Stat label="Initial Equity" value={fmtMoney2(result.metrics.initial_equity)} />
                  </div>

                  <div className="mt-3 text-xs text-[var(--muted)] italic">
                    Equity starts at {fmtMoney2(result.metrics.initial_equity)} and steps up/down only on exit days (one position at a time).
                  </div>
                </div>

                {/* Optimizer + Trades toggle quick link */}
                <div className="flex flex-col h-full">
                  <div className="card p-6 mb-6">
                    <OptimizerPanel
                      strategy={strategy}
                      result={result}
                      trades={(tradesWithBars as any) as (Trade & { daysBars?: number })[]}
                    />
                    <div className="mt-4">
                      <button className="btn-accent px-3 py-2 rounded-lg text-sm font-medium" onClick={()=>setActive("trades")}>
                        View Trades
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ===== TRADES TAB ===== */}
          {active === "trades" && result && (
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-2xl font-bold tracking-tight text-[var(--accent)]">
                  Trades ({(result.trades ?? []).length})
                </h3>
                <div className="flex gap-2 text-xs text-[var(--muted)]">
                  <button
                    className={
                      "px-3 py-1 rounded-md border " +
                      (tradeView === "cards" ? "bg-[var(--accent)] text-[#0b0c10] border-[var(--accent)]" : "border-[var(--border)] text-[var(--text)]")
                    }
                    onClick={() => setTradeView("cards")}
                  >
                    Cards
                  </button>
                  <button
                    className={
                      "px-3 py-1 rounded-md border " +
                      (tradeView === "table" ? "bg-[var(--accent)] text-[#0b0c10] border-[var(--accent)]" : "border-[var(--border)] text-[var(--text)]")
                    }
                    onClick={() => setTradeView("table")}
                  >
                    Table
                  </button>
                </div>
              </div>

              {tradeView === "cards" ? (
                <div className="overflow-x-auto">
                  <div className="grid auto-cols-[210px] grid-flow-col gap-4">
                    {tradesWithBars.map((t, i) => {
                      const positive = t.pnl >= 0;
                      return (
                        <div key={i} className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
                          <div className="text-sm font-semibold text-[var(--text)] mb-2">{t.entry_date}</div>
                          <div className="text-sm text-[var(--text)]/80 space-y-1">
                            <Row k="Entry Px" v={t.entry_price.toFixed(2)} />
                            <Row k="Exit Px" v={t.exit_price.toFixed(2)} />
                            <Row k="PnL" v={`${positive ? "+" : ""}${t.pnl.toFixed(2)}`} tone={positive ? "win" : "loss"} />
                            <Row k="Return" v={`${(t.return_pct * 100).toFixed(2)}%`} tone={positive ? "win" : "loss"} />
                            <Row k="Bars" v={Number.isFinite((t as any).daysBars) ? (t as any).daysBars : "-"} />
                            <div className="flex justify-end">
                              <span className={"px-2 py-0.5 rounded-full text-xs " + (positive ? "bg-[var(--up)]/15 text-up" : "bg-[var(--down)]/15 text-down")}>
                                {positive ? "Win" : "Loss"}
                              </span>
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
                      <tr className="text-[var(--text)]">
                        <Th onClick={() => toggleSort("entry_date")}>Date In {sortKey === "entry_date" ? (sortDir === "asc" ? "^" : "v") : ""}</Th>
                        <Th onClick={() => toggleSort("exit_date")}>Date Out {sortKey === "exit_date" ? (sortDir === "asc" ? "^" : "v") : ""}</Th>
                        <Th>Entry</Th><Th>Exit</Th>
                        <Th onClick={() => toggleSort("pnl")}>PnL {sortKey === "pnl" ? (sortDir === "asc" ? "^" : "v") : ""}</Th>
                        <Th onClick={() => toggleSort("return_pct")}>Return % {sortKey === "return_pct" ? (sortDir === "asc" ? "^" : "v") : ""}</Th>
                        <Th onClick={() => toggleSort("daysBars")}>Bars {sortKey === "daysBars" ? (sortDir === "asc" ? "^" : "v") : ""}</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {tradesWithBars.map((t, i) => (
                        <tr key={i} className={t.pnl >= 0 ? "text-up" : "text-down"}>
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
          )}

          {/* ===== DRAWDOWN TAB ===== */}
          {active === "drawdown" && result && (
            <div className="card p-6">
              <DrawdownChart equity={safeEquityCurve} />
            </div>
          )}

          {active !== "docs" && !result && (active === "results" || active === "trades" || active === "drawdown") && (
            <div className="text-center text-sm text-[var(--muted)] mt-6">
              No backtest yet. Run <span className="font-semibold">Peek</span> then <span className="font-semibold">Backtest</span>.
            </div>
          )}

          <div className="text-center text-xs text-[var(--muted)] mt-8">
            Created by <span className="font-semibold">Aryan Rawat</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ========== Small UI bits ========== */
function Stat({
  label, value, sub, numeric, tint = false
}: {
  label: string; value: string; sub?: string; numeric?: number | null; tint?: boolean;
}) {
  const tone =
    tint && Number.isFinite(numeric)
      ? (numeric! > 0 ? "text-up" : numeric! < 0 ? "text-down" : "text-[var(--text)]")
      : "text-[var(--text)]";

  return (
    <div className="p-5 rounded-xl bg-[var(--panel)] border border-[var(--border)]">
      <div className="text-sm text-[var(--muted)]">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums whitespace-nowrap leading-snug ${tone}`}>{value}</div>
      {sub && <div className="text-xs text-[var(--muted)] mt-1">{sub}</div>}
    </div>
  );
}
function Row({ k, v, tone }: { k: string; v: any; tone?: "win" | "loss" }) {
  const c = tone === "win" ? "text-up" : tone === "loss" ? "text-down" : "text-[var(--text)]/80";
  return <div className={`flex justify-between ${c}`}><span>{k}</span><span className="tabular-nums">{v}</span></div>;
}
function Th({ children, onClick }: { children: any; onClick?: () => void }) {
  return <th className="cursor-pointer text-[var(--text)]/90" onClick={onClick}>{children}</th>;
}

/* ========== Optimizer Panel ========== */
function OptimizerPanel({
  strategy,
  result,
  trades,
}: {
  strategy: StrategyKey;
  result: BacktestResponse;
  trades: (Trade & { daysBars?: number })[];
}) {
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

  const sumWins = sum(wins.map((t) => t.pnl));
  const sumLossAbs = Math.abs(sum(losses.map((t) => t.pnl)));
  const profitFactor =
    sumLossAbs === 0 ? (sumWins > 0 ? Infinity : 0) : sumWins / sumLossAbs;

  const avgWin = wins.length ? sumWins / wins.length : 0;
  const avgLossAbs =
    losses.length ? Math.abs(sum(losses.map((t) => t.pnl)) / losses.length) : 0;
  const hitRate = trades.length ? wins.length / trades.length : 0;
  const expectancy = avgWin * hitRate - avgLossAbs * (1 - hitRate);

  const bars = trades.map((t) => t.daysBars).filter((b) => Number.isFinite(b)) as number[];
  const avgBars = bars.length ? sum(bars) / bars.length : 0;
  const medBars = bars.length ? [...bars].sort((a, b) => a - b)[Math.floor(bars.length / 2)] : 0;

  const sugg: string[] = [];
  const mdd = result.metrics.max_drawdown;
  const ann = result.metrics.annualized_return;
  const hdCfg = Number(result.params.hold_days || 0);

  if (trades.length < 5) sugg.push("Few trades — widen date range or loosen entry to collect more samples.");
  if (expectancy <= 0 && trades.length >= 5) sugg.push("Negative expectancy — nudge entries tighter or exits sooner to cut losers faster.");
  if (profitFactor < 1 && trades.length >= 5) sugg.push("Profit factor < 1 — improve R/R by tightening entries or shortening holds.");
  if (mdd > 0.20) sugg.push("Max drawdown > 20% — add a simple trend filter (e.g., 50D MA) or a stop.");
  if (Math.abs(ann) < 0.02 && trades.length >= 10) sugg.push("Low annualized return — sweep nearby parameters (small grid).");
  if (Number.isFinite(avgBars) && Number.isFinite(hdCfg) && avgBars > hdCfg + 0.5) sugg.push("Average bars exceed configured hold — verify alignment or use fixed-bars exit.");

  if (strategy === "breakout") {
    sugg.unshift("Breakout: try threshold ±2–5% around suggested and hold 2–5 days.");
  } else if (strategy === "sma_cross") {
    sugg.unshift("SMA Cross: test fast/slow pairs like 5/20, 10/30, 20/50; require price above slow to reduce chop.");
  } else if (strategy === "mean_rev") {
    sugg.unshift("Mean Reversion: sweep drop% from 1–4% and short holds (2–4 days); consider exit on snap-back to MA.");
  }
  if (sugg.length < 2) sugg.push("Run a quick parameter sweep near current settings.");

  return (
    <div className="flex-1 flex flex-col">
      <h3 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--accent)] mb-3">
        Optimizer Insights
      </h3>

      <div className="flex flex-col gap-2 mb-4">
        <MetricRow label="Profit Factor" value={Number.isFinite(profitFactor) ? profitFactor.toFixed(2) : "∞"} numeric={profitFactor - 1} tint />
        <MetricRow label="Expectancy / Trade" value={fmtSignedMoney2(expectancy)} numeric={expectancy} tint />
        <MetricRow label="Hit Rate" value={fmtPct2(hitRate)} numeric={hitRate - 0.5} tint />
        <MetricRow label="Avg Bars (Median)" value={`${avgBars.toFixed(1)} (${medBars})`} />
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3">
        <div className="text-[12px] font-semibold text-[var(--text)]/80 mb-1.5">Suggestions</div>
        <ul className="list-disc ml-5 text-[12px] leading-5 text-[var(--text)]/80 space-y-1">
          {sugg.slice(0, 4).map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
function MetricRow({ label, value, numeric, tint = false }: { label: string; value: string; numeric?: number; tint?: boolean }) {
  const s = String(value);
  const significantLen = s.replace(/[^\d.%$\-+]/g, "").length;
  const valueSize =
    significantLen > 12 ? "text-base sm:text-lg"
      : significantLen > 9 ? "text-lg sm:text-xl"
      : "text-xl sm:text-2xl";
  const tone =
    tint && Number.isFinite(numeric)
      ? (numeric! > 0 ? "text-up" : numeric! < 0 ? "text-down" : "text-[var(--text)]")
      : "text-[var(--text)]";

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-2 h-14 flex items-center justify-between">
      <div className="text-[11px] sm:text-xs text-[var(--muted)] mr-3">{label}</div>
      <div className={`${valueSize} font-semibold tabular-nums leading-none ${tone}`}>
        {s}
      </div>
    </div>
  );
}

/* ========== Symbol Index ========== */
function SymbolIndex({
  list,
  current,
  onPick,
}: {
  list: string[];
  current?: string;
  onPick: (s: string) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toUpperCase();
    if (!s) return list;
    return list.filter(x => x.toUpperCase().includes(s));
  }, [q, list]);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 h-full">
      <div className="text-sm font-semibold text-[var(--text)] mb-2">Symbol Index</div>
      <input
        className="input mb-3"
        placeholder="Search symbols…"
        value={q}
        onChange={(e)=>setQ(e.target.value)}
      />
      <div className="max-h-[360px] overflow-auto pr-1">
        {filtered.map((s) => (
          <button
            key={s}
            onClick={()=>onPick(s)}
            className={
              "w-full text-left px-3 py-2 rounded-md mb-1 border " +
              (current===s
                ? "bg-[var(--accent)]/20 border-[var(--accent)] text-[var(--text)]"
                : "bg-transparent border-[var(--border)] hover:border-[var(--accent)] text-[var(--text)]/90")
            }
          >
            {s}
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="text-xs text-[var(--muted)] italic px-1">No matches</div>
        )}
      </div>
    </div>
  );
}
