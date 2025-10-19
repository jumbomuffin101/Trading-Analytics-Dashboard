// cloudfare-api/src/index.ts
// Yahoo-backed API with robust CORS and UI-compatible shapes (stats/summary blocks).

const ALLOW_ORIGIN = "https://jumbomuffin101.github.io"; // domain only

function corsHeaders(origin = ALLOW_ORIGIN) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "POST, OPTIONS, GET",
    "vary": "origin",
  };
}
function withCors(resp: Response, origin?: string) {
  const hdrs = new Headers(resp.headers);
  for (const [k, v] of Object.entries(corsHeaders(origin))) hdrs.set(k, v);
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: hdrs });
}
function asJson(data: unknown, status = 200, origin?: string) {
  return withCors(new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } }), origin);
}
function asText(msg: string, status = 200, origin?: string) {
  return withCors(new Response(msg, { status, headers: { "content-type": "text/plain; charset=utf-8" } }), origin);
}

type OHLC = { date: string; open: number; high: number; low: number; close: number };

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
        }>;
      };
    }>;
    error?: unknown;
  };
};

async function fetchYahooDaily(symbol: string, start?: string, end?: string): Promise<OHLC[]> {
  try {
    let url: string;
    if (start && end) {
      const p1 = Math.floor(new Date(`${start}T00:00:00Z`).getTime() / 1000);
      const p2 = Math.floor(new Date(`${end}T23:59:59Z`).getTime() / 1000);
      url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d&includePrePost=false&events=div%2Csplit`;
    } else {
      url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=6mo&interval=1d&includePrePost=false&events=div%2Csplit`;
    }
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return [];
    const json = (await res.json()) as YahooChartResponse;

    const result = json.chart?.result?.[0];
    const ts = result?.timestamp ?? [];
    const q = result?.indicators?.quote?.[0] ?? {};
    const o = q.open ?? [], h = q.high ?? [], l = q.low ?? [], c = q.close ?? [];

    const out: OHLC[] = [];
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i]; if (t == null) continue;
      const open = Number(o[i]), high = Number(h[i]), low = Number(l[i]), close = Number(c[i]);
      if (!isFinite(open) || !isFinite(high) || !isFinite(low) || !isFinite(close)) continue;
      const date = new Date(t * 1000).toISOString().slice(0, 10);
      out.push({ date, open, high, low, close });
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    return out;
  } catch {
    return [];
  }
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const num = (x: unknown, d = 2) => +((typeof x === "number" && isFinite(x) ? x : 0).toFixed(d));

/* ----------------------- /peek shape (adds stats) ----------------------- */
function buildPeekPayload(symbol: string, preview: OHLC[]) {
  if (!preview.length) {
    const base = {
      symbol, start: "", end: "", rows: 0, preview: [] as OHLC[],
      min_close: 0, median_close: 0, max_close: 0, suggested_threshold: 0,
      minClose: 0, medianClose: 0, maxClose: 0, suggestedThreshold: 0,
    };
    return { ...base, stats: {
      min_close: 0, median_close: 0, max_close: 0, suggested_threshold: 0,
      minClose: 0, medianClose: 0, maxClose: 0, suggestedThreshold: 0,
    }};
  }

  const closes = preview.map(p => p.close);
  const min_close = num(Math.min(...closes));
  const max_close = num(Math.max(...closes));
  const median_close = num(median(closes));
  const suggested_threshold = +(((median_close - min_close) / (max_close - min_close || 1)) / 10).toFixed(3);

  const start = preview[0].date;
  const end   = preview[preview.length - 1].date;

  // flat + aliases + nested stats (so UI reading stats.* works)
  return {
    symbol, start, end,
    rows: preview.length, preview,
    min_close, median_close, max_close, suggested_threshold,
    minClose: min_close, medianClose: median_close, maxClose: max_close, suggestedThreshold: suggested_threshold,
    stats: {
      min_close, median_close, max_close, suggested_threshold,
      minClose: min_close, medianClose: median_close, maxClose: max_close, suggestedThreshold: suggested_threshold,
    }
  };
}

/* -------------------- /backtest shape (adds summary) -------------------- */
type Trade = { entry_date: string; entry_price: number; exit_date: string; exit_price: number; pnl: number; return_pct: number };

function runThresholdBacktest(data: OHLC[], threshold = 0.005, holdDays = 5, equityStart = 1000) {
  const trades: Trade[] = [];
  const closes = data.map(d => d.close);

  for (let i = 1; i < data.length - holdDays; i++) {
    const ret = (closes[i] - closes[i - 1]) / closes[i - 1];
    if (ret >= threshold) {
      const entry = data[i], exit = data[i + holdDays];
      const pnl = +(exit.close - entry.close);
      const return_pct = +(((exit.close - entry.close) / entry.close) * 100);
      trades.push({
        entry_date: entry.date, entry_price: num(entry.close),
        exit_date: exit.date,   exit_price: num(exit.close),
        pnl: num(pnl), return_pct: num(return_pct),
      });
    }
  }

  let equity = equityStart;
  const equity_curve = [{ date: data[0]?.date ?? "", equity: num(equity) }];
  for (const t of trades) {
    equity = num(equity * (1 + t.return_pct / 100));
    equity_curve.push({ date: t.exit_date, equity });
  }

  const def: Trade = { entry_date: "", entry_price: 0, exit_date: "", exit_price: 0, pnl: 0, return_pct: 0 };
  const best_trade  = trades.length ? trades.reduce((a,b)=> a.return_pct >= b.return_pct ? a : b) : def;
  const worst_trade = trades.length ? trades.reduce((a,b)=> a.return_pct <= b.return_pct ? a : b) : def;
  const wins = trades.filter(t => t.pnl > 0).length;
  const win_rate_pct = trades.length ? num((wins / trades.length) * 100) : 0;

  const equity_start = equityStart;
  const equity_end   = equity_curve[equity_curve.length - 1]?.equity ?? equity_start;

  // flat + aliases + nested summary (so UI reading summary.* works)
  return {
    trades,
    equity_curve,
    equity_start, equity_end,
    best_trade, worst_trade,
    total_trades: trades.length,
    win_rate_pct,
    // aliases
    equityCurve: equity_curve,
    equityStart: equity_start,
    equityEnd: equity_end,
    totalTrades: trades.length,
    winRatePct: win_rate_pct,
    // nested summary
    summary: {
      equity_start, equity_end,
      equityStart: equity_start, equityEnd: equity_end,
      total_trades: trades.length, totalTrades: trades.length,
      win_rate_pct, winRatePct: win_rate_pct,
      best_trade, worst_trade,
    }
  };
}

/* ----------------------------- Route handlers ---------------------------- */
async function handlePeek(body: any) {
  const symbol = (body?.symbol || "SPY").toString().toUpperCase();
  const start = body?.start ? String(body.start) : undefined;
  const end   = body?.end   ? String(body.end)   : undefined;
  const preview = await fetchYahooDaily(symbol, start, end);
  return buildPeekPayload(symbol, preview);
}

async function handleBacktest(body: any) {
  const symbol = (body?.symbol || "SPY").toString().toUpperCase();
  const start = body?.start ? String(body.start) : undefined;
  const end   = body?.end   ? String(body.end)   : undefined;
  const threshold = body?.threshold != null ? Number(body.threshold) : 0.005;
  const holdDays  = body?.hold_days != null ? Math.max(1, Number(body.hold_days)) : 5;

  const data = await fetchYahooDaily(symbol, start, end);
  if (!data.length) {
    const empty = runThresholdBacktest([{ date: "", open: 0, high: 0, low: 0, close: 0 }], threshold, holdDays, 1000);
    // overwrite trades to [] if synthetic was added
    empty.trades = [];
    empty.total_trades = 0;
    empty.totalTrades = 0;
    empty.win_rate_pct = 0;
    empty.winRatePct = 0;
    empty.equity_curve = [{ date: "", equity: 1000 }];
    empty.equityCurve = empty.equity_curve;
    empty.equity_start = 1000;
    empty.equity_end = 1000;
    empty.equityStart = 1000;
    empty.equityEnd = 1000;
    empty.summary = {
      equity_start: 1000, equity_end: 1000,
      equityStart: 1000, equityEnd: 1000,
      total_trades: 0, totalTrades: 0,
      win_rate_pct: 0, winRatePct: 0,
      best_trade: { entry_date: "", entry_price: 0, exit_date: "", exit_price: 0, pnl: 0, return_pct: 0 },
      worst_trade:{ entry_date: "", entry_price: 0, exit_date: "", exit_price: 0, pnl: 0, return_pct: 0 },
    };
    return { symbol, start: start ?? "", end: end ?? "", ...empty };
  }
  const bt = runThresholdBacktest(data, threshold, holdDays, 1000);
  return { symbol, start: data[0].date, end: data[data.length - 1].date, ...bt };
}

/* --------------------------------- Worker -------------------------------- */
export default {
  async fetch(req: Request): Promise<Response> {
    const origin = req.headers.get("Origin") || ALLOW_ORIGIN;
    try {
      const url = new URL(req.url);
      const path = url.pathname;

      if (req.method === "OPTIONS") return withCors(new Response(null), origin);
      if (req.method === "GET" && (path === "/" || path === "/status")) {
        return asJson({ ok: true, ts: Date.now(), path }, 200, origin);
      }
      if (req.method !== "POST") return asText("POST only", 405, origin);

      let body: any = {};
      try { body = await req.json(); } catch { return asText("Invalid JSON body", 400, origin); }

      if (path.endsWith("/peek"))     return asJson(await handlePeek(body), 200, origin);
      if (path.endsWith("/backtest")) return asJson(await handleBacktest(body), 200, origin);
      return asText("Unknown route. Use /peek or /backtest.", 404, origin);
    } catch (err: any) {
      return asJson({ detail: err?.message ?? "Internal error" }, 500, req.headers.get("Origin") || ALLOW_ORIGIN);
    }
  },
} satisfies ExportedHandler;
