import { useMemo, useState, useEffect, useRef, useCallback } from "react";
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
const pick = <T,>(...xs: T[]) =>
  xs.find((v) => v !== undefined && v !== null) as T;

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
  for (const x of eq) {
    if (x.equity > p) p = x.equity;
    m = Math.min(m, p ? (x.equity - p) / p : 0);
  }
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
  const lastEq = equity_curve.length
    ? equity_curve[equity_curve.length - 1].equity
    : initial_equity;
  const final_equity = n(pick(raw?.metrics?.final_equity, raw?.equity_end, lastEq));
  const total_pnl = n(final_equity - initial_equity);
  const win_rate = n(pick(raw?.metrics?.win_rate, raw?.win_rate_pct, 0), 4) /
                   (raw?.metrics?.win_rate ? 1 : 100);
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
    params: { threshold, hold_days, ...(raw?.params ?? {}) },
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
    const sent =
      typeof r?.config?.data === "string" ? JSON.parse(r.config.data) : r?.config?.data;
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
  exit_date: string; exit_price: number;
  pnl: number; return_pct: number;
};

type BacktestResponse = {
  symbol: string; start: string; end: string;
  params: { threshold?: number; hold_days?: number } & Record<string, any>;
  metrics: {
    total_pnl: number; win_rate: number; annualized_return: number;
    max_drawdown: number; final_equity: number; initial_equity: number
  };
  trades: Trade[];
  equity_curve: { date: string; equity: number }[];
  price_series?: { date: string; close: number }[];
  note?: string;
};

type StrategyKey = "legacy_absolute" | "breakout_pct" | "breakout_atr" | "mean_reversion";
const PRESETS = ["AAPL","MSFT","NVDA","AMZN","META","GOOGL","TSLA","SPY","QQQ","NFLX"];

/* ========= Fallback symbols ========= */
const DEFAULT_SYMBOLS: string[] = [
  "A","AA","AAPL","ABBV","ABNB","ABT","ACN","ADBE","ADI","ADM","ADP","ADSK","AEP","AIG","ALB","ALL",
  "AMAT","AMD","AMGN","AMP","AMT","AMZN","ANET","APA","APD","APH","ASML","ATVI","AVGO","AXP",
  "BA","BAC","BAX","BBY","BDX","BIIB","BK","BKNG","BLK","BMY","BRK.B","BSX","C","CARR","CAT","CB","CCI",
  "CCL","CDNS","CDW","CE","CELH","CHTR","CL","CMCSA","CME","COF","COIN","COP","COST","CRM","CRWD","CSCO",
  "CSX","CTAS","CTSH","CTVA","CVS","CVX","DD","DE","DELL","DHI","DHR","DIS","DKNG","DOW","DPZ","DUK","DVN",
  "EA","EL","EMR","ENPH","ETN","ETSY","EW","EXC","F","FDX","FI","FIS","FISV","FOX","FOXA","FTNT","GE",
  "GILD","GIS","GLD","GM","GOOG","GOOGL","GPN","GS","HD","HES","HON","HPE","HPQ","HUM","IBM","ICE","ILMN",
  "INTC","INTU","ISRG","JNJ","JPM","KHC","KMI","KO","KR","LIN","LMT","LOW","LRCX","LULU","LUV","LYFT","MA",
  "MAR","MCD","MCHP","MCO","MDB","MDLZ","MDT","META","MET","MMM","MO","MRK","MRNA","MRVL","MS","MSFT","MU",
  "NFLX","NKE","NOC","NOW","NUE","NVDA","NVO","OKTA","ORCL","OXY","PANW","PARA","PAYC","PAYX","PEP","PFE",
  "PG","PLD","PLTR","PM","PNC","PYPL","QCOM","QQQ","REGN","RIVN","ROKU","ROP","SBUX","SCHW","SHOP","SMCI",
  "SNOW","SO","SPG","SPGI","SPY","SQ","T","TECL","TEAM","TEL","TGT","TJX","TMUS","TSLA","TSM","TTD","TXN",
  "UAL","UBER","UNH","UNP","UPS","V","VLO","VRSK","VRTX","VZ","WBA","WBD","WDAY","WELL","WFC","WMT","XLE",
  "XLF","XLK","XOM","ZM",
];

const fmtDate = (iso: string) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  }).format(dt);
};

const fmtMoney  = (v:number) =>
  Number.isFinite(v) ? "$" + Math.round(v).toLocaleString() : "";
const fmtMoney2 = (v:number) =>
  Number.isFinite(v)
    ? "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "";
const fmtPct1   = (v:number) => Number.isFinite(v) ? (v*100).toFixed(1) + "%" : "";
const fmtPct2   = (v:number) => Number.isFinite(v) ? (v*100).toFixed(2) + "%" : "";
const fmtSignedMoney2 = (v:number) =>
  !Number.isFinite(v) ? "" :
  (v >= 0 ? "+" : "−") +
  Math.abs(v).toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

type ChartMode = "equity" | "price";
type SortKey = "entry_date" | "exit_date" | "pnl" | "return_pct" | "daysBars";

/* ========== Recharts palette ========== */
const PALETTE = {
  grid: "var(--grid)",
  axis: "var(--muted)",
  tooltipBg: "var(--panel)",
  tooltipBorder: "var(--border)",
  text: "var(--text)",
  priceLine: "var(--cyan)",
  equityLine: "var(--cyan)",
  equityFill: "rgba(0, 184, 212, 0.14)",
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

/* ======= Sections + Tabs ======= */
const SECTIONS = [
  { id: "docs", label: "Docs" },
  { id: "peek", label: "Peek" },
  { id: "strategy", label: "Strategy" },
  { id: "results", label: "Results" },
  { id: "drawdown", label: "Drawdown" },
] as const;

function useActiveSection() {
  const [active, setActive] = useState<string>("docs");
  const observer = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const opts = { root: null, rootMargin: "0px 0px -70% 0px", threshold: [0, 0.2, 0.6] };
    const cb: IntersectionObserverCallback = (entries) => {
      entries.forEach((entry) => { if (entry.isIntersecting) setActive(entry.target.id); });
    };
    observer.current = new IntersectionObserver(cb, opts);
    SECTIONS.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.current?.observe(el);
    });
    return () => observer.current?.disconnect();
  }, []);

  return { active, setActive };
}

function TabBar({ active, setActive }: { active: string; setActive: (id: string) => void }) {
  const scrollTo = (id: string) => {
    setActive(id);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <div className="sticky top-0 z-30 bg-[var(--bg)]/85 backdrop-blur border-b border-[var(--border)]">
      <div className="mx-auto max-w-6xl px-4 py-2">
        <div
          role="tablist"
          aria-label="Sections"
          className="flex gap-2 overflow-x-auto whitespace-nowrap"
          style={{ scrollbarWidth: "none" }}
        >
          {SECTIONS.map(({ id, label }) => {
            const isActive = active === id;
            return (
              <button
                key={id}
                role="tab"
                aria-selected={isActive}
                aria-controls={id}
                onClick={() => scrollTo(id)}
                className={[
                  "inline-flex items-center justify-center rounded-lg border transition",
                  "h-10 md:h-11 px-3 md:px-4 text-sm md:text-base font-medium tracking-wide",
                  isActive
                    ? "bg-[var(--accent)] text-[#0b0c10] border-[var(--accent)] shadow-[0_1px_0_rgba(0,0,0,0.08)]"
                    : "bg-[var(--panel)] text-[var(--text)] border-[var(--border)] hover:border-[var(--accent)] hover:-translate-y-[1px]",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60",
                ].join(" ")}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ======= Symbol Index (Searchable) ======= */
function useSymbols() {
  const [symbols, setSymbols] = useState<string[]>(
    () => [...new Set(DEFAULT_SYMBOLS.concat(PRESETS))].sort()
  );

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}symbols.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((arr: string[]) => {
        if (Array.isArray(arr)) {
          const merged = [...new Set([...symbols, ...arr.map((s) => String(s).toUpperCase())])].sort();
          setSymbols(merged);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return symbols;
}

function SymbolIndex({
  value, onPick,
}: { value: string; onPick: (s: string) => void; }) {
  const all = useSymbols();
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const term = q.trim().toUpperCase();
    const base = all;
    if (!term) return base;
    return base.filter((s) => s.includes(term));
  }, [q, all]);

  const groups = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of filtered) {
      const k = /^[A-Z]/.test(s[0]) ? s[0] : "#";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(s);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3 lg:sticky lg:top-16 h-max">
      <div className="text-sm font-semibold text-[var(--text)] mb-2">Symbol Index</div>
      <input
        className="input mb-3"
        placeholder="Search (e.g. NVDA)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="max-h-[360px] overflow-auto pr-1">
        {groups.map(([letter, list]) => (
          <div key={letter} className="mb-2">
            <div className="text-xs text-[var(--muted)] mb-1">{letter}</div>
            <div className="flex flex-wrap gap-1.5">
              {list.map((sym) => {
                const active = value === sym;
                return (
                  <button
                    key={sym}
                    className={
                      "px-2 py-1 rounded-md border text-xs " +
                      (active
                        ? "bg-[var(--accent)] text-[#0b0c10] border-[var(--accent)]"
                        : "bg-[var(--bg)] text-[var(--text)] border-[var(--border)] hover:border-[var(--accent)]")
                    }
                    onClick={() => onPick(sym)}
                    type="button"
                    title={sym}
                  >
                    {sym}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 text-[10px] text-[var(--muted)]">
        Tip: Add a large <code>public/symbols.json</code> to load more tickers.
      </div>
    </div>
  );
}

/* ========== Main App ========== */
export default function App() {
  const today = new Date();
  const yday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const ydayISO = yday.toISOString().slice(0,10);
  const startISO = new Date(yday.getFullYear(), yday.getMonth(), yday.getDate() - 120).toISOString().slice(0,10);

  const [symbol, setSymbol] = useState("");
  const [start, setStart] = useState(startISO);
  const [end, setEnd] = useState(ydayISO);
  const [threshold, setThreshold] = useState("");
  const [holdDays, setHoldDays] = useState("4");

  const [peek, setPeek] = useState<PeekResponse | null>(null);
  const [result, setResult] = useState<BacktestResponse | null>(null);

  const [loading, setLoading] = useState(false);
  const [peekBusy, setPeekBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<ChartMode>("equity");
  const [sortKey, setSortKey] = useState<SortKey>("entry_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [tradeView, setTradeView] = useState<"cards" | "table">("cards");

  // ==== Strategy state (matches backend) ====
  const [strategy, setStrategy] = useState<StrategyKey>("breakout_pct");

  // Common knobs for non-legacy strategies
  const [lookback, setLookback] = useState("20");
  const [maxHoldDays, setMaxHoldDays] = useState("5");
  const [takeProfitPct, setTakeProfitPct] = useState("0.02");
  const [stopLossPct, setStopLossPct] = useState("0.01");
  const [cooldownDays, setCooldownDays] = useState("0");
  const [allowLong, setAllowLong] = useState(true);
  const [allowShort, setAllowShort] = useState(true);
  const [allowImmediateReentry, setAllowImmediateReentry] = useState(true);

  // Breakout specific
  const [thresholdPct, setThresholdPct] = useState("0.003"); // 0.3% default
  const [atrK, setAtrK] = useState("0.5");

  // Mean reversion specific (human %; convert later)
  const [revDropPct, setRevDropPct] = useState("2.0");

  const onStartChange = (v: string) => {
    const newStart = v;
    setStart(newStart);
    if (newStart > end) setEnd(newStart);
  };
  const onEndChange = (v: string) => {
    const newEnd = v;
    setEnd(newEnd);
    if (newEnd < start) setStart(newEnd);
  };

  useEffect(() => {
    setPeek(null);
    setResult(null);
    setError(null);
  }, [symbol]);

  useEffect(() => {
    if (end > ydayISO) setEnd(ydayISO);
  }, [end, ydayISO]);

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

  /* --------- Peek: cancel stale calls; fire immediately on first click --------- */
  const peekAbortRef = useRef<AbortController | null>(null);
  const doPeek = useCallback(async () => {
    if (!canPeek || peekBusy) return;
    setError(null);
    setResult(null);
    setPeek(null);
    setPeekBusy(true);

    // cancel any in-flight peek first
    try { peekAbortRef.current?.abort(); } catch {}
    const ctrl = new AbortController();
    peekAbortRef.current = ctrl;

    try {
      const res = await api.post<PeekResponse>(
        "/peek",
        { symbol, start, end },
        { signal: ctrl.signal as any }
      );
      setPeek(res.data);
      if (isFinite(res.data?.suggested_threshold)) {
        setThreshold(res.data.suggested_threshold.toFixed(2));
      }
    } catch (e: any) {
      if (e?.name !== "CanceledError" && e?.message !== "canceled") {
        setError(e?.response?.data?.detail ?? e?.message ?? "Peek failed");
        setPeek(null);
      }
    } finally {
      setPeekBusy(false);
    }
  }, [symbol, start, end, canPeek, peekBusy]);

  // ===== Build params for the new backend strategies =====
  const buildStrategyParams = () => {
    if (strategy === "legacy_absolute") return undefined;

    const common = {
      allow_long: allowLong,
      allow_short: allowShort,
      take_profit_pct: Number(takeProfitPct) || 0,
      stop_loss_pct: Number(stopLossPct) || 0,
      cooldown_days: Math.max(0, parseInt(cooldownDays || "0", 10)),
      allow_immediate_reentry: allowImmediateReentry,
    };

    if (strategy === "breakout_pct") {
      return {
        strategy,
        lookback: Math.max(5, Number(lookback) || 20),
        threshold_pct: Number(thresholdPct) || undefined, // fractional input (0.003 = 0.3%)
        max_hold_days: Math.max(1, Number(maxHoldDays) || 5),
        ...common,
      };
    }
    if (strategy === "breakout_atr") {
      return {
        strategy,
        lookback: Math.max(10, Number(lookback) || 20),
        atr_k: Number(atrK) || undefined,
        max_hold_days: Math.max(1, Number(maxHoldDays) || 5),
        ...common,
      };
    }
    if (strategy === "mean_reversion") {
      const dropFraction = (() => {
        const raw = revDropPct.trim();
        if (!raw) return 0.01;
        const v = Number(raw);
        if (!isFinite(v)) return 0.01;
        return v >= 1 ? v / 100 : v; // human % -> fraction
      })();
      return {
        strategy,
        lookback: Math.max(5, Number(lookback) || 20),
        drop_pct: Math.max(0.001, Math.min(0.2, dropFraction)), // clamp sane range
        max_hold_days: Math.max(1, Number(maxHoldDays) || 1),
        ...common,
      };
    }
    return undefined;
  };

  // ===== Mean Reversion: quick local estimator to show "smaller drop% → more trades"
  const mrEstimate = useMemo(() => {
    if (strategy !== "mean_reversion") return null;

    // pick a working series: prefer preview if present (faster), else result price series
    const closes: number[] =
      (peek?.preview?.map(p => Number(p.close)).filter(Number.isFinite)) ??
      [];
    const closesAlt: number[] =
      (result?.price_series?.map(p => Number(p.close)).filter(Number.isFinite)) ??
      [];

    const series = closes.length ? closes : closesAlt;
    if (series.length < 10) return null;

    const lb = Math.max(5, Number(lookback) || 20);
    const raw = revDropPct.trim();
    const v = Number(raw);
    const drop = !isFinite(v) ? 0.01 : (v >= 1 ? v/100 : v);
    const allowL = allowLong;
    const allowS = allowShort;

    // sma helper
    const sma = (arr: number[], i: number, w: number) => {
      let sum = 0, c = 0;
      for (let k = Math.max(0, i - w + 1); k <= i; k++) { sum += arr[k]; c++; }
      return c ? sum / c : NaN;
    };

    let signals = 0;
    for (let i = lb; i < series.length; i++) {
      const m = sma(series, i, lb);
      const c = series[i];
      if (!isFinite(m) || !isFinite(c)) continue;
      if (allowL && c <= m * (1 - drop)) signals++;
      if (allowS && c >= m * (1 + drop)) signals++;
    }
    return Math.max(0, signals);
  }, [strategy, peek, result, lookback, revDropPct, allowLong, allowShort]);

  const doBacktest = async () => {
    setError(null);
    setLoading(true);
    setResult(null);
    try {
      const thr = parseThreshold();
      const hd = parseHoldDays();

      if (strategy === "legacy_absolute") {
        if (thr === null) throw new Error("Please enter a valid numeric threshold (try Peek).");
        if (hd === null) throw new Error("Hold Days must be a whole number >= 1.");
      }

      const params = buildStrategyParams();

      const payload: any = {
        symbol, start, end,
        ...(strategy === "legacy_absolute"
          ? { threshold: thr, hold_days: hd }
          : {}),
        ...(params ? { params } : {}),
      };

      const res = await api.post<BacktestResponse>("/backtest", payload);
      setResult(res.data);
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
  const hdInvalid = holdDays.trim() !== "" && parseHoldDays() === null;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  const { active, setActive } = useActiveSection();

  return (
    <div className="theme-terminal">
      <div className="page-root min-h-screen bg-[var(--bg)] text-[var(--text)]">
        <div className="relative overflow-hidden">
          <div className="relative mx-auto max-w-6xl px-4 pt-10 pb-6">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl bg-[var(--accent)] text-[#0b0c10] flex items-center justify-center font-black">
                $
              </div>
              <h1 className="text-4xl font-bold">Trading Analytics Dashboard</h1>
            </div>
          </div>
        </div>

        <TabBar active={active} setActive={setActive} />

        <div className="mx-auto max-w-6xl px-4 pt-6 pb-10 space-y-8">

          {/* =================== Documentation =================== */}
          <div id="docs" className="card p-6 sm:p-7">
            <h3 className="text-2xl font-bold tracking-tight text-[var(--accent)]">Documentation</h3>
            <ul className="mt-3 text-sm text-[var(--text)]/80 leading-6 list-disc pl-5 space-y-1">
              <li><strong>Pick a symbol & dates:</strong> use presets or type your own; dates are auto-corrected so Start ≤ End.</li>
              <li><strong>Peek:</strong> fetches a quick snapshot with min/median/max closes and a <em>suggested threshold</em>.</li>
              <li><strong>Choose a strategy:</strong> Absolute (legacy), Breakout (percent or ATR), or Mean Reversion (SMA).</li>
              <li><strong>Run Backtest:</strong> equity curve is cash-only and steps on exit days; price chart shows entries/exits.</li>
              <li><strong>Read the tiles:</strong> good values appear <span className="text-up font-medium">green</span>; unfavorable values are <span className="text-down font-medium">red</span>.</li>
              <li><strong>Assumptions:</strong> daily closes only; no fees/slippage/leverage; one position at a time.</li>
            </ul>
          </div>

          {/* Peek & symbols + Symbol Index */}
          <div id="peek" className="card p-6 sm:p-7">
            <h3 className="text-2xl font-bold tracking-tight text-[var(--accent)]">Peek &amp; Symbols</h3>
            <div className="text-xs text-[var(--muted)] mt-1 mb-3">Type or pick a symbol, choose dates, and click Peek.</div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Controls + presets */}
              <div className="lg:col-span-2">
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

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
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
                  <button
                    className="btn-accent px-3 py-2 rounded-lg text-sm font-medium"
                    onClick={doPeek}
                    disabled={peekBusy || !canPeek}
                    aria-busy={peekBusy}
                  >
                    {peekBusy ? (<><Spinner /><span className="ml-2">Peeking…</span></>) : "Peek"}
                  </button>
                </div>

                {error && <div className="mt-3"><ErrorBanner msg={error} onClose={()=>setError(null)} /></div>}
                {peekBusy && !peek && <div className="mt-4"><SkeletonCard /></div>}

                {peek && (
                  <div className="mt-5 p-6 rounded-xl border border-[var(--border)] bg-[var(--panel)] space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--accent)]">
                          {peek.symbol} Market Snapshot
                        </h3>
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

              {/* Right: Symbol Index */}
              <div className="lg:col-span-1">
                <SymbolIndex value={symbol} onPick={setSymbol} />
              </div>
            </div>
          </div>

          {/* Strategy & Parameters */}
          <div id="strategy" className="card p-6 sm:p-7">
            <h3 className="text-2xl font-bold tracking-tight text-[var(--accent)] mb-3">Strategy & Parameters</h3>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 lg:col-span-2">
                <label className="text-sm sm:col-span-2">
                  <div className="mb-1 text-[var(--text)]/80">Strategy</div>
                  <select className="input" value={strategy} onChange={(e) => setStrategy(e.target.value as StrategyKey)}>
                    <option value="legacy_absolute">Absolute Threshold (legacy)</option>
                    <option value="breakout_pct">Breakout (Percent)</option>
                    <option value="breakout_atr">Breakout (ATR)</option>
                    <option value="mean_reversion">Mean Reversion (SMA)</option>
                  </select>
                </label>

                {/* LEGACY: absolute threshold */}
                {strategy === "legacy_absolute" && (
                  <>
                    <label className="text-sm">
                      <div className="mb-1 text-[var(--text)]/80">Threshold (absolute price)</div>
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

                {/* BREAKOUT (Percent) */}
                {strategy === "breakout_pct" && (
                  <>
                    <label className="text-sm">
                      <div className="mb-1 text-[var(--text)]/80">Lookback (days)</div>
                      <input className="input" inputMode="numeric" value={lookback} onChange={(e)=>setLookback(e.target.value)} placeholder="e.g. 20" />
                    </label>
                    <label className="text-sm">
                      <div className="mb-1 text-[var(--text)]/80">Threshold % (fraction)</div>
                      <input className="input" inputMode="decimal" step="any" value={thresholdPct} onChange={(e)=>setThresholdPct(e.target.value)} placeholder="e.g. 0.003 = 0.3%" />
                    </label>
                    <label className="text-sm">
                      <div className="mb-1 text-[var(--text)]/80">Max Hold Days</div>
                      <input className="input" inputMode="numeric" pattern="[0-9]*" min={1} value={maxHoldDays} onChange={(e)=>setMaxHoldDays(e.target.value)} placeholder="e.g. 5" />
                    </label>
                  </>
                )}

                {/* BREAKOUT (ATR) */}
                {strategy === "breakout_atr" && (
                  <>
                    <label className="text-sm">
                      <div className="mb-1 text-[var(--text)]/80">Lookback (days)</div>
                      <input className="input" inputMode="numeric" value={lookback} onChange={(e)=>setLookback(e.target.value)} placeholder="e.g. 20" />
                    </label>
                    <label className="text-sm">
                      <div className="mb-1 text-[var(--text)]/80">ATR Multiplier (k)</div>
                      <input className="input" inputMode="decimal" step="any" value={atrK} onChange={(e)=>setAtrK(e.target.value)} placeholder="e.g. 0.5" />
                    </label>
                    <label className="text-sm">
                      <div className="mb-1 text-[var(--text)]/80">Max Hold Days</div>
                      <input className="input" inputMode="numeric" pattern="[0-9]*" min={1} value={maxHoldDays} onChange={(e)=>setMaxHoldDays(e.target.value)} placeholder="e.g. 5" />
                    </label>
                  </>
                )}

                {/* MEAN REVERSION */}
                {strategy === "mean_reversion" && (
                  <>
                    <label className="text-sm">
                      <div className="mb-1 text-[var(--text)]/80">SMA Lookback (days)</div>
                      <input className="input" inputMode="numeric" value={lookback} onChange={(e)=>setLookback(e.target.value)} placeholder="e.g. 20" />
                    </label>
                    <label className="text-sm">
                      <div className="mb-1 text-[var(--text)]/80">Drop % (enter number like 2 for 2%)</div>
                      <input className="input" inputMode="decimal" step="any" value={revDropPct} onChange={(e)=>setRevDropPct(e.target.value)} placeholder="e.g. 2" />
                    </label>
                    <label className="text-sm">
                      <div className="mb-1 text-[var(--text)]/80">Max Hold Days</div>
                      <input className="input" inputMode="numeric" pattern="[0-9]*" min={1} value={maxHoldDays} onChange={(e)=>setMaxHoldDays(e.target.value)} placeholder="e.g. 1" />
                    </label>

                    {/* Inline estimator: confirms smaller drop% => more trades */}
                    <div className="sm:col-span-2 text-xs text-[var(--muted)]">
                      Est. signals in window:{" "}
                      <span className="font-semibold text-[var(--text)]">
                        {mrEstimate === null ? "—" : `~${mrEstimate}`}
                      </span>{" "}
                      <span className="text-[var(--muted)]/80">
                        (smaller Drop % → more trades)
                      </span>
                    </div>
                  </>
                )}

                {/* Common controls for non-legacy strategies */}
                {strategy !== "legacy_absolute" && (
                  <>
                    <div className="sm:col-span-2 grid grid-cols-2 gap-3">
                      <label className="inline-flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={allowLong} onChange={(e)=>setAllowLong(e.target.checked)} />
                        <span>Allow Long</span>
                      </label>
                      <label className="inline-flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={allowShort} onChange={(e)=>setAllowShort(e.target.checked)} />
                        <span>Allow Short</span>
                      </label>
                    </div>

                    <label className="text-sm">
                      <div className="mb-1 text-[var(--text)]/80">Take Profit (fraction)</div>
                      <input className="input" inputMode="decimal" step="any" value={takeProfitPct} onChange={(e)=>setTakeProfitPct(e.target.value)} placeholder="e.g. 0.02 = 2%" />
                    </label>

                    <label className="text-sm">
                      <div className="mb-1 text-[var(--text)]/80">Stop Loss (fraction)</div>
                      <input className="input" inputMode="decimal" step="any" value={stopLossPct} onChange={(e)=>setStopLossPct(e.target.value)} placeholder="e.g. 0.01 = 1%" />
                    </label>

                    <label className="text-sm">
                      <div className="mb-1 text-[var(--text)]/80">Cooldown Days</div>
                      <input className="input" inputMode="numeric" pattern="[0-9]*" min={0} value={cooldownDays} onChange={(e)=>setCooldownDays(e.target.value)} placeholder="e.g. 0" />
                    </label>

                    <label className="text-sm inline-flex items-center gap-2">
                      <input type="checkbox" checked={allowImmediateReentry} onChange={(e)=>setAllowImmediateReentry(e.target.checked)} />
                      <span className="text-[var(--text)]/80">Allow Immediate Re-entry</span>
                    </label>
                  </>
                )}

                <div className="sm:col-span-2 flex items-center gap-3">
                  <button
                    className="btn-accent px-3 py-2 rounded-lg text-sm font-medium"
                    onClick={doBacktest}
                    disabled={loading || !canPeek}
                  >
                    {loading ? (<><Spinner /><span className="ml-2">Running…</span></>) : "Run Backtest"}
                  </button>
                </div>
              </div>

              {/* Strategy explanations */}
              <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 text-[13px] leading-6">
                <div className="font-semibold text-[var(--text)] mb-1">How this works</div>
                {strategy === "legacy_absolute" && (
                  <ul className="list-disc ml-5 text-[var(--text)]/80 space-y-1">
                    <li><strong>Intent:</strong> close crosses a fixed <strong>price threshold</strong> from below.</li>
                    <li><strong>Entry:</strong> first daily close ≥ Threshold.</li>
                    <li><strong>Exit:</strong> after <strong>Hold Days</strong> bars.</li>
                    <li><strong>Tip:</strong> start near Peek’s <em>Suggested Threshold</em>, then sweep ±2–5%.</li>
                  </ul>
                )}
                {strategy === "breakout_pct" && (
                  <ul className="list-disc ml-5 text-[var(--text)]/80 space-y-1">
                    <li><strong>Intent:</strong> momentum on closes breaking prior highs/lows by a <strong>%</strong>.</li>
                    <li><strong>Adaptive:</strong> if left blank, threshold% auto-scales to volatility.</li>
                    <li><strong>Exit:</strong> TP/SL or <strong>Max Hold Days</strong>, whichever first.</li>
                    <li><strong>Tip:</strong> short holds + both directions = more trades.</li>
                  </ul>
                )}
                {strategy === "breakout_atr" && (
                  <ul className="list-disc ml-5 text-[var(--text)]/80 space-y-1">
                    <li><strong>Intent:</strong> momentum using <strong>ATR</strong> buffer above/below extremes.</li>
                    <li><strong>Adaptive:</strong> ATR multiplier <em>k</em> defaults relative to realized ATR.</li>
                    <li><strong>Exit:</strong> TP/SL or <strong>Max Hold Days</strong>.</li>
                    <li><strong>Tip:</strong> try k ≈ 0.4–0.6 for denser signals.</li>
                  </ul>
                )}
                {strategy === "mean_reversion" && (
                  <ul className="list-disc ml-5 text-[var(--text)]/80 space-y-1">
                    <li><strong>Intent:</strong> buy dips / sell rips vs SMA; quick snap-backs.</li>
                    <li><strong>Adaptive:</strong> <strong>Drop %</strong> (e.g., 2) becomes 0.02; defaults scale with vol.</li>
                    <li><strong>Exit:</strong> on mean-touch or <strong>Max Hold Days</strong>.</li>
                    <li><strong>Tip:</strong> 1–2 hold days with small drops ↑ trades.</li>
                  </ul>
                )}
              </div>
            </div>
          </div>

          {/* Backtest Results (includes Trades + Optimizer) */}
          {result && (
            <>
              <div id="results" className="grid lg:grid-cols-3 gap-8 items-stretch">
                <div className="card p-6 lg:col-span-2 flex flex-col relative">
                  {loading && (
                    <div className="absolute inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center rounded-xl z-10">
                      <div className="px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--panel)] text-sm">
                        <Spinner />
                        <span className="ml-2">Crunching numbers…</span>
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
                  </div>

                  <div className="w-full h-[380px] mt-2">
                    <ResponsiveContainer>
                      {mode === "equity" ? (
                        <AreaChart data={result?.equity_curve ?? []} margin={{ left: 68, right: 16, top: 10, bottom: 38 }}>
                          <defs>
                            <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={PALETTE.priceLine} stopOpacity={0.28} />
                              <stop offset="95%" stopColor={PALETTE.priceLine} stopOpacity={0.04} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid stroke={PALETTE.grid} vertical={false} />
                          <XAxis dataKey="date" tickMargin={12} stroke={PALETTE.axis}
                                 tickFormatter={(d) => new Intl.DateTimeFormat("en-US", { year: "numeric", month: "2-digit" }).format(new Date(d))}>
                            <Label value="Date" position="bottom" offset={24} fill={PALETTE.axis} />
                          </XAxis>
                          <YAxis stroke={PALETTE.axis} tickFormatter={fmtMoney} tickMargin={10}>
                            <Label value="Equity ($)" angle={-90} position="insideLeft" offset={14} dx={-60} dy={30} fill={PALETTE.axis} />
                          </YAxis>
                          <Tooltip
                            contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--text)" }}
                            formatter={(v: any) => [fmtMoney2(v as number), "Equity"]}
                          />
                          <Area type="monotone" dataKey="equity" stroke={PALETTE.priceLine} fill="url(#eqFill)" strokeWidth={2} />
                        </AreaChart>
                      ) : (
                        <LineChart data={result?.price_series ?? []} margin={{ left: 72, right: 16, top: 10, bottom: 38 }}>
                          <CartesianGrid stroke={PALETTE.grid} vertical={false} />
                          <XAxis dataKey="date" tickMargin={12} stroke={PALETTE.axis} tickFormatter={xTickFormatter}>
                            <Label value="Date" position="bottom" offset={24} fill={PALETTE.axis} />
                          </XAxis>
                          <YAxis stroke={PALETTE.axis} tickFormatter={fmtMoney} tickMargin={10}>
                            <Label value="Price ($)" angle={-90} position="insideLeft" offset={14} dx={-28} dy={10} fill={PALETTE.axis} />
                          </YAxis>
                          <Tooltip
                            contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--text)" }}
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

{/* Trades + Optimizer */}
<div className="flex flex-col h-full">
  <div className="card p-6 mb-6">
    <div className="flex items-center justify-between mb-4">
      <h3 className="text-2xl font-bold tracking-tight text-[var(--accent)]">
        Trades ({tradesWithBars.length})
      </h3>
      <div className="flex gap-2 text-xs text-[var(--muted)]">
        <button
          className={
            "px-3 py-1 rounded-md border " +
            (tradeView === "cards"
              ? "bg-[var(--accent)] text-[#0b0c10] border-[var(--accent)]"
              : "border-[var(--border)] text-[var(--text)]")
          }
          onClick={() => setTradeView("cards")}
        >
          Cards
        </button>
        <button
          className={
            "px-3 py-1 rounded-md border " +
            (tradeView === "table"
              ? "bg-[var(--accent)] text-[#0b0c10] border-[var(--accent)]"
              : "border-[var(--border)] text-[var(--text)]")
          }
          onClick={() => setTradeView("table")}
        >
          Table
        </button>
      </div>
    </div>

    {tradeView === "cards" ? (
      // SINGLE-ROW horizontal lane with snap-scrolling (no wrapping)
      <div className="overflow-x-auto pb-2 snap-x snap-mandatory min-w-0">
        <div className="grid grid-flow-col grid-rows-1 auto-cols-[260px] gap-4">
          {tradesWithBars.map((t, i) => {
            const positive = t.pnl >= 0;
            return (
              <div
                key={i}
                className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 h-full snap-start shrink-0"
              >
                <div className="text-sm font-semibold text-[var(--text)] mb-2">
                  {t.entry_date}
                </div>
                <div className="text-sm text-[var(--text)]/80 space-y-1">
                  <Row k="Entry Px" v={t.entry_price.toFixed(2)} />
                  <Row k="Exit Px"  v={t.exit_price.toFixed(2)} />
                  <Row
                    k="PnL"
                    v={`${positive ? "+" : ""}${t.pnl.toFixed(2)}`}
                    tone={positive ? "win" : "loss"}
                  />
                  <Row
                    k="Return"
                    v={`${(t.return_pct * 100).toFixed(2)}%`}
                    tone={positive ? "win" : "loss"}
                  />
                  <Row
                    k="Bars"
                    v={
                      Number.isFinite((t as any).daysBars)
                        ? (t as any).daysBars
                        : "-"
                    }
                  />
                  <div className="flex justify-end pt-1">
                    <span
                      className={
                        "px-2 py-0.5 rounded-full text-xs " +
                        (positive
                          ? "bg-[var(--up)]/15 text-up"
                          : "bg-[var(--down)]/15 text-down")
                      }
                    >
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
              <Th onClick={() => toggleSort("entry_date")}>
                Date In {sortKey === "entry_date" ? (sortDir === "asc" ? "^" : "v") : ""}
              </Th>
              <Th onClick={() => toggleSort("exit_date")}>
                Date Out {sortKey === "exit_date" ? (sortDir === "asc" ? "^" : "v") : ""}
              </Th>
              <Th>Entry</Th><Th>Exit</Th>
              <Th onClick={() => toggleSort("pnl")}>
                PnL {sortKey === "pnl" ? (sortDir === "asc" ? "^" : "v") : ""}
              </Th>
              <Th onClick={() => toggleSort("return_pct")}>
                Return % {sortKey === "return_pct" ? (sortDir === "asc" ? "^" : "v") : ""}
              </Th>
              <Th onClick={() => toggleSort("daysBars")}>
                Bars {sortKey === "daysBars" ? (sortDir === "asc" ? "^" : "v") : ""}
              </Th>
            </tr>
          </thead>
          <tbody>
            {tradesWithBars.map((t, i) => (
              <tr key={i} className={t.pnl >= 0 ? "text-up" : "text-down"}>
                <td>{t.entry_date}</td><td>{t.exit_date}</td>
                <td>{t.entry_price.toFixed(2)}</td><td>{t.exit_price.toFixed(2)}</td>
                <td>{t.pnl.toFixed(2)}</td>
                <td>{(t.return_pct * 100).toFixed(2)}%</td>
                <td>{Number.isFinite((t as any).daysBars) ? (t as any).daysBars : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>

                  <OptimizerPanel
                    strategy={strategy}
                    result={result}
                    trades={(tradesWithBars as any) as (Trade & { daysBars?: number })[]}
                  />
                </div>
              </div>

              <div id="drawdown">
                <DrawdownChart equity={result.equity_curve} />
              </div>
            </>
          )}

          <div className="text-center text-xs text-[var(--muted)]">
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
}: { label: string; value: string; sub?: string; numeric?: number | null; tint?: boolean; }) {
  const tone =
    tint && Number.isFinite(numeric)
      ? numeric! > 0 ? "text-up" : numeric! < 0 ? "text-down" : "text-[var(--text)]"
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
  return (
    <div className={`flex items-center justify-between gap-2 ${c}`}>
      <span className="truncate">{k}</span>
      <span className="tabular-nums whitespace-nowrap">{v}</span>
    </div>
  );
}

function Th({ children, onClick }: { children: any; onClick?: () => void }) {
  return (
    <th className="cursor-pointer text-[var(--text)]/90" onClick={onClick}>
      {children}
    </th>
  );
}

/* ========== Optimizer Panel ========== */
function OptimizerPanel({
  strategy, result, trades,
}: { strategy: StrategyKey; result: BacktestResponse; trades: (Trade & { daysBars?: number })[]; }) {
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);

  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const sumWins = sum(wins.map((t) => t.pnl));
  const sumLossAbs = Math.abs(sum(losses.map((t) => t.pnl)));
  const profitFactor = sumLossAbs === 0 ? (sumWins > 0 ? Infinity : 0) : sumWins / sumLossAbs;

  const avgWin = wins.length ? sumWins / wins.length : 0;
  const avgLossAbs = losses.length ? Math.abs(sum(losses.map((t) => t.pnl)) / losses.length) : 0;

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
  if (expectancy <= 0 && trades.length >= 5) sugg.push("Negative expectancy — nudge entries tighter or exits sooner.");
  if (profitFactor < 1 && trades.length >= 5) sugg.push("Profit factor < 1 — improve R/R by tightening entries or shortening holds.");
  if (mdd > 0.20) sugg.push("Max drawdown > 20% — add a trend filter (e.g., 50D MA) or a stop.");
  if (Math.abs(ann) < 0.02 && trades.length >= 10) sugg.push("Low annualized return — sweep nearby parameters.");
  if (Number.isFinite(avgBars) && Number.isFinite(hdCfg) && avgBars > hdCfg + 0.5) sugg.push("Average bars exceed configured hold — verify alignment.");

  if (strategy === "legacy_absolute") {
    sugg.unshift("Legacy: try threshold ±2–5% around suggested and hold 2–5 days.");
  } else if (strategy === "breakout_pct") {
    sugg.unshift("Breakout%: use lower threshold% and short holds (3–6) to increase trades.");
  } else if (strategy === "breakout_atr") {
    sugg.unshift("Breakout ATR: smaller k (0.4–0.6) and short holds increase turnover.");
  } else if (strategy === "mean_reversion") {
    sugg.unshift("Mean Reversion: small drop% (1–3) and 1–2 hold days boost trade count.");
  }
  if (sugg.length < 2) sugg.push("Run a quick parameter sweep near current settings.");

  return (
    <div className="card p-6 flex-1 flex flex-col">
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
          {sugg.slice(0, 4).map((s, i) => (<li key={i}>{s}</li>))}
        </ul>
      </div>
    </div>
  );
}

function MetricRow({
  label, value, numeric, tint = false
}: { label: string; value: string; numeric?: number; tint?: boolean }) {
  const s = String(value);
  const significantLen = s.replace(/[^\d.%$\-+]/g, "").length;
  const valueSize =
    significantLen > 12 ? "text-base sm:text-lg" :
    significantLen > 9  ? "text-lg sm:text-xl" :
                           "text-xl sm:text-2xl";
  const tone =
    tint && Number.isFinite(numeric)
      ? numeric! > 0 ? "text-up" : numeric! < 0 ? "text-down" : "text-[var(--text)]"
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
