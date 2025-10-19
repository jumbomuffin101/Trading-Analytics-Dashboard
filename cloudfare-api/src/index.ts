// cloudfare-api/src/index.ts
// Always returns CORS headers; hardened against throw paths.

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
  const ch = corsHeaders(origin);
  for (const [k, v] of Object.entries(ch)) hdrs.set(k, v);
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: hdrs });
}

function asJson(data: unknown, status = 200, origin?: string) {
  return withCors(new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  }), origin);
}

function asText(msg: string, status = 200, origin?: string) {
  return withCors(new Response(msg, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  }), origin);
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
    // Never throw past here — return empty to be handled gracefully
    return [];
  }
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function handlePeek(body: any) {
  const symbol = (body?.symbol || "SPY").toString().toUpperCase();
  const start = body?.start ? String(body.start) : undefined;
  const end   = body?.end   ? String(body.end)   : undefined;

  const preview = await fetchYahooDaily(symbol, start, end);
  if (!preview.length) {
    return { detail: "No data for symbol/date range", symbol, preview: [], rows: 0 };
  }

  const closes = preview.map(p => p.close);
  const min_close = Math.min(...closes);
  const max_close = Math.max(...closes);
  const median_close = median(closes);
  const suggested_threshold = +(((median_close - min_close) / (max_close - min_close || 1)) / 10).toFixed(3);

  return {
    symbol,
    start: preview[0].date,
    end: preview[preview.length - 1].date,
    min_close: +min_close.toFixed(2),
    median_close: +median_close.toFixed(2),
    max_close: +max_close.toFixed(2),
    suggested_threshold,
    rows: preview.length,
    preview,
  };
}

function runThresholdBacktest(data: OHLC[], threshold = 0.005, holdDays = 5, equityStart = 1000) {
  type Trade = { entry_date: string; entry_price: number; exit_date: string; exit_price: number; pnl: number; return_pct: number };
  const trades: Trade[] = [];
  const closes = data.map(d => d.close);

  for (let i = 1; i < data.length - holdDays; i++) {
    const ret = (closes[i] - closes[i - 1]) / closes[i - 1];
    if (ret >= threshold) {
      const entry = data[i], exit = data[i + holdDays];
      const pnl = +(exit.close - entry.close);
      const return_pct = +(((exit.close - entry.close) / entry.close) * 100);
      trades.push({
        entry_date: entry.date, entry_price: +entry.close.toFixed(2),
        exit_date: exit.date,   exit_price: +exit.close.toFixed(2),
        pnl: +pnl.toFixed(2), return_pct: +return_pct.toFixed(2),
      });
    }
  }

  let equity = equityStart;
  const equity_curve = [{ date: data[0]?.date ?? "", equity: +equity.toFixed(2) }];
  for (const t of trades) {
    equity = +(equity * (1 + t.return_pct / 100)).toFixed(2);
    equity_curve.push({ date: t.exit_date, equity });
  }

  const def: Trade = { entry_date: "", entry_price: 0, exit_date: "", exit_price: 0, pnl: 0, return_pct: 0 };
  const best_trade  = trades.reduce((a,b)=> a.return_pct >= b.return_pct ? a : b, trades[0] ?? def);
  const worst_trade = trades.reduce((a,b)=> a.return_pct <= b.return_pct ? a : b, trades[0] ?? def);
  const wins = trades.filter(t => t.pnl > 0).length;
  const win_rate_pct = trades.length ? +((wins / trades.length) * 100).toFixed(2) : 0;

  return {
    trades,
    equity_curve,
    equity_start: equityStart,
    equity_end: equity_curve[equity_curve.length - 1]?.equity ?? equityStart,
    best_trade, worst_trade,
    total_trades: trades.length,
    win_rate_pct,
  };
}

async function handleBacktest(body: any) {
  const symbol = (body?.symbol || "SPY").toString().toUpperCase();
  const start = body?.start ? String(body.start) : undefined;
  const end   = body?.end   ? String(body.end)   : undefined;
  const threshold = body?.threshold != null ? Number(body.threshold) : 0.005;
  const holdDays  = body?.hold_days != null ? Math.max(1, Number(body.hold_days)) : 5;

  const data = await fetchYahooDaily(symbol, start, end);
  if (!data.length) {
    return {
      symbol, start: start ?? "", end: end ?? "",
      trades: [], equity_curve: [{ date: "", equity: 1000 }],
      equity_start: 1000, equity_end: 1000,
      best_trade: { entry_date: "", entry_price: 0, exit_date: "", exit_price: 0, pnl: 0, return_pct: 0 },
      worst_trade:{ entry_date: "", entry_price: 0, exit_date: "", exit_price: 0, pnl: 0, return_pct: 0 },
      total_trades: 0, win_rate_pct: 0,
      detail: "No data for symbol/date range",
    };
  }

  const bt = runThresholdBacktest(data, threshold, holdDays, 1000);
  return { symbol, start: data[0].date, end: data[data.length - 1].date, ...bt };
}

export default {
  async fetch(req: Request): Promise<Response> {
    // Read request Origin once (so we can echo it if you ever want dynamic allowlists)
    const origin = req.headers.get("Origin") || ALLOW_ORIGIN;

    try {
      const url = new URL(req.url);
      const path = url.pathname;

      // Preflight
      if (req.method === "OPTIONS") {
        return withCors(new Response(null), origin);
      }

      // Health BEFORE POST guard
      if (req.method === "GET" && (path === "/" || path === "/status")) {
        return asJson({ ok: true, ts: Date.now(), path }, 200, origin);
      }

      // Only POST for API routes
      if (req.method !== "POST") {
        return asText("POST only", 405, origin);
      }

      // Parse JSON body
      let body: any = {};
      try {
        body = await req.json();
      } catch {
        return asText("Invalid JSON body", 400, origin);
      }

      // Routes
      if (path.endsWith("/peek"))     return asJson(await handlePeek(body), 200, origin);
      if (path.endsWith("/backtest")) return asJson(await handleBacktest(body), 200, origin);

      return asText("Unknown route. Use /peek or /backtest.", 404, origin);
    } catch (err: any) {
      // Absolute last-resort catch — ALWAYS include CORS
      const message = typeof err?.message === "string" ? err.message : "Internal error";
      return asJson({ detail: message }, 500, req.headers.get("Origin") || ALLOW_ORIGIN);
    }
  },
} satisfies ExportedHandler;
