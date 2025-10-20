// src/lib/api.ts
import axios from "axios";

/* ====== Axios client ====== */
const BASE = (import.meta as any).env?.VITE_API_BASE || "/api";
const api = axios.create({ baseURL: BASE, timeout: 25000 });

/* ====== Helpers used by normalizers ====== */
const n = (x: unknown, d = 2) =>
  +((typeof x === "number" && isFinite(x) ? x : 0).toFixed(d));
const pick = <T,>(...xs: T[]) => xs.find((v) => v !== undefined && v !== null) as T;

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

/* ====== Normalizers (same shapes your App expects) ====== */
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

/* ====== Response interceptor ====== */
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

export default api;
