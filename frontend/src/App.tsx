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

  // choose from nested stats, flat snake_case, or camelCase
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
    (preview.length ? preview[0].date : "") ??
    "";
  const end =
    raw?.end ??
    (preview.length ? preview[preview.length - 1].date : "") ??
    "";

  const symbol = (raw?.symbol ?? "").toString();

  const normalized = {
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

  return normalized;
}

function toDecimalPct(x: unknown) {
  const v = Number(x);
  if (!isFinite(v)) return 0;
  // if it looks like 2.3 (== 2.3%), convert to 0.023
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
  return Math.abs(mdd); // return as positive fraction (0–1)
}

function normalizeBacktest(raw: any, reqBodyJson: any) {
  // arrays
  const tradesRaw = Array.isArray(raw?.trades) ? raw.trades : [];
  const equity_curve =
    Array.isArray(raw?.equity_curve)
      ? raw.equity_curve
      : Array.isArray(raw?.equityCurve)
      ? raw.equityCurve
      : [];

  // convert trade return_pct to decimals if needed
  const trades = tradesRaw.map((t: any) => ({
    entry_date: String(t.entry_date ?? ""),
    entry_price: n(t.entry_price),
    exit_date: String(t.exit_date ?? ""),
    exit_price: n(t.exit_price),
    pnl: n(t.pnl),
    return_pct: toDecimalPct(t.return_pct),
  }));

  // params: prefer the ones we sent in the request body
  let threshold = Number(reqBodyJson?.threshold);
  if (!isFinite(threshold)) {
    threshold = Number(pick(raw?.params?.threshold, raw?.threshold, 0));
  }
  const hold_days = Number.isFinite(Number(reqBodyJson?.hold_days))
    ? Number(reqBodyJson?.hold_days)
    : Number(pick(raw?.params?.hold_days, raw?.hold_days, 0));

  // metrics inputs
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

  // annualized return from start/end dates if available
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

  // price_series: fill from preview if backend included it, else empty
  const price_series =
    Array.isArray(raw?.price_series) && raw.price_series.length
      ? raw.price_series
      : Array.isArray(raw?.preview)
      ? raw.preview.map((p: any) => ({ date: String(p.date ?? ""), close: n(p.close) }))
      : [];

  const normalized = {
    symbol: String(raw?.symbol ?? ""),
    start: startStr,
    end: endStr,
    params: { threshold, hold_days },
    metrics: {
      total_pnl,
      win_rate,               // fraction 0–1
      annualized_return,      // fraction 0–1
      max_drawdown,           // fraction 0–1
      final_equity,
      initial_equity,
    },
    trades,
    equity_curve,
    price_series,
    note: raw?.detail || raw?.note,
  };

  return normalized;
}

api.interceptors.response.use(
  (response) => {
    try {
      const url = String(response?.config?.url || "");
      // parse original request body (so we can retain threshold/hold_days)
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

/* ========= YOUR TYPES & UI (unchanged) ========= */

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

/* ======= rest of your original component remains unchanged ======= */

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

/* …everything else in your component below is unchanged … */
