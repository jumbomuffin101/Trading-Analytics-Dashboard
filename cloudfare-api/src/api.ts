// frontend/src/lib/api.ts
import axios from "axios";

/** Use Worker URL in prod, /api in local dev */
const BASE = (import.meta as any).env?.VITE_API_BASE || "/api";

// ---- helpers ---------------------------------------------------------------
const n = (x: unknown, d = 2) =>
  +((typeof x === "number" && isFinite(x) ? x : 0).toFixed(d));
const pick = <T>(...candidates: T[]) => {
  for (const c of candidates) if (c !== undefined && c !== null) return c;
  return undefined as unknown as T;
};

// Normalize /peek payload so UI can safely read stats.median_close, etc.
function normalizePeek(raw: any) {
  const preview = Array.isArray(raw?.preview) ? raw.preview : [];

  const min_close = n(
    pick(raw?.stats?.min_close, raw?.min_close, raw?.minClose, 0)
  );
  const median_close = n(
    pick(raw?.stats?.median_close, raw?.median_close, raw?.medianClose, 0)
  );
  const max_close = n(
    pick(raw?.stats?.max_close, raw?.max_close, raw?.maxClose, 0)
  );
  const suggested_threshold = +(
    pick(
      raw?.stats?.suggested_threshold,
      raw?.suggested_threshold,
      raw?.suggestedThreshold,
      0
    ) ?? 0
  ).toFixed(3);

  const rows =
    typeof raw?.rows === "number"
      ? raw.rows
      : Array.isArray(preview)
      ? preview.length
      : 0;

  const start =
    raw?.start ??
    (preview.length ? preview[0].date : "") ??
    "";
  const end =
    raw?.end ??
    (preview.length ? preview[preview.length - 1].date : "") ??
    "";

  const symbol = (raw?.symbol ?? "").toString();

  // Build the nested stats block the UI expects AND keep top-level copies.
  const stats = {
    min_close,
    median_close,
    max_close,
    suggested_threshold,
    // camelCase aliases (just in case)
    minClose: min_close,
    medianClose: median_close,
    maxClose: max_close,
    suggestedThreshold: suggested_threshold,
  };

  return {
    symbol,
    start,
    end,
    rows,
    preview,
    // top-level (some UIs read these)
    min_close,
    median_close,
    max_close,
    suggested_threshold,
    // nested (your UI likely uses these)
    stats,
  };
}

// Normalize /backtest payload so UI can safely read summary.*, trades[], equity_curve[]
function normalizeBacktest(raw: any) {
  const trades = Array.isArray(raw?.trades) ? raw.trades : [];
  const equity_curve = Array.isArray(raw?.equity_curve)
    ? raw.equity_curve
    : Array.isArray(raw?.equityCurve)
    ? raw.equityCurve
    : [];

  const equity_start = n(pick(raw?.equity_start, raw?.equityStart, 1000));
  const equity_end = n(
    pick(
      raw?.equity_end,
      raw?.equityEnd,
      equity_curve.length
        ? equity_curve[equity_curve.length - 1].equity
        : equity_start
    )
  );

  const win_rate_pct = n(pick(raw?.win_rate_pct, raw?.winRatePct, 0));
  const total_trades =
    typeof raw?.total_trades === "number"
      ? raw.total_trades
      : typeof raw?.totalTrades === "number"
      ? raw.totalTrades
      : trades.length;

  const best_trade =
    raw?.best_trade ??
    {
      entry_date: "",
      entry_price: 0,
      exit_date: "",
      exit_price: 0,
      pnl: 0,
      return_pct: 0,
    };

  const worst_trade =
    raw?.worst_trade ??
    {
      entry_date: "",
      entry_price: 0,
      exit_date: "",
      exit_price: 0,
      pnl: 0,
      return_pct: 0,
    };

  const start = raw?.start ?? "";
  const end = raw?.end ?? "";
  const symbol = (raw?.symbol ?? "").toString();

  const summary = {
    equity_start,
    equity_end,
    total_trades,
    win_rate_pct,
    best_trade,
    worst_trade,
    // camelCase aliases
    equityStart: equity_start,
    equityEnd: equity_end,
    totalTrades: total_trades,
    winRatePct: win_rate_pct,
  };

  return {
    symbol,
    start,
    end,
    trades,
    equity_curve,
    summary,
    // also keep top-level copies (some UIs use these)
    equity_start,
    equity_end,
    total_trades,
    win_rate_pct,
    best_trade,
    worst_trade,
  };
}

// ---- axios instance --------------------------------------------------------
export const api = axios.create({
  baseURL: BASE,
  timeout: 20000,
});

// Transform responses so components always get the expected shape
api.interceptors.response.use(
  (response) => {
    try {
      const url = (response?.config?.url || "").toString();
      if (url.endsWith("/peek")) {
        response.data = normalizePeek(response.data ?? {});
      } else if (url.endsWith("/backtest")) {
        response.data = normalizeBacktest(response.data ?? {});
      }
    } catch (e) {
      // keep raw data if normalization throws
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

console.info("[api] baseURL =", BASE);

// Convenience wrappers (optional, or keep using api.post directly)
export async function postPeek(body: any) {
  const { data } = await api.post("/peek", body);
  return data;
}
export async function postBacktest(body: any) {
  const { data } = await api.post("/backtest", body);
  return data;
}
