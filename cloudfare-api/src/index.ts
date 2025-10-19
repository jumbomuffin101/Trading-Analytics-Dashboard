// cloudfare-api/src/index.ts
// Returns payloads that match the frontend's original expectations exactly.

const PAGES_ORIGIN = "https://jumbomuffin101.github.io";

const json = (data: unknown, status = 200, origin = PAGES_ORIGIN) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": origin,
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "POST, OPTIONS, GET",
      "vary": "origin",
    },
  });

const text = (msg: string, status = 200, origin = PAGES_ORIGIN) =>
  new Response(msg, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "access-control-allow-origin": origin,
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "POST, OPTIONS, GET",
      "vary": "origin",
    },
  });

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
  };
};

const clampNum = (v: unknown, d = 2) =>
  +((typeof v === "number" && isFinite(v) ? v : 0).toFixed(d));

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

async function fetchYahooDaily(symbol: string, start?: string, end?: string): Promise<OHLC[]> {
  try {
    let url: string;
    if (start && end) {
      const p1 = Math.floor(new Date(`${start}T00:00:00Z`).getTime() / 1000);
      const p2 = Math.floor(new Date(`${end}T23:59:59Z`).getTime() / 1000);
      url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
        symbol
      )}?period1=${p1}&period2=${p2}&interval=1d&includePrePost=false&events=div%2Csplit`;
    } else {
      url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
        symbol
      )}?range=6mo&interval=1d&includePrePost=false&events=div%2Csplit`;
    }
    const r = await fetch(url, { headers: { accept: "application/json" } });
    if (!r.ok) return [];
    const data = (await r.json()) as YahooChartResponse;
    const res = data.chart?.result?.[0];
    const ts = res?.timestamp ?? [];
    const q = res?.indicators?.quote?.[0] ?? {};
    const o = q.open ?? [];
    const h = q.high ?? [];
    const l = q.low ?? [];
    const c = q.close ?? [];

    const out: OHLC[] = [];
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i];
      if (t == null) continue;
      const open = Number(o[i]),
        high = Number(h[i]),
        low = Number(l[i]),
        close = Number(c[i]);
      if (![open, high, low, close].every(Number.isFinite)) continue;
      const date = new Date(t * 1000).toISOString().slice(0, 10);
      out.push({ date, open, high, low, close });
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    return out;
  } catch {
    return [];
  }
}

/* ------------------------------- /peek -------------------------------- */

async function handlePeek(body: any) {
  const symbol = (body?.symbol || "SPY").toString().toUpperCase();
  const start = body?.start ? String(body.start) : undefined;
  const end = body?.end ? String(body.end) : undefined;

  const preview = await fetchYahooDaily(symbol, start, end);
  if (!preview.length) {
    return {
      symbol,
      start: start ?? "",
      end: end ?? "",
      min_close: 0,
      median_close: 0,
      max_close: 0,
      suggested_threshold: 0,
      rows: 0,
      preview: [] as OHLC[],
      note: "No data for symbol/date range",
    };
  }

  const closes = preview.map((p) => p.close);
  const min_close = clampNum(Math.min(...closes));
  const max_close = clampNum(Math.max(...closes));
  const median_close = clampNum(median(closes));
  // heuristic: 75th-percentile-ish distance scaled to a usable absolute price step
  const suggested_threshold = +(((median_close - min_close) / (max_close - min_close || 1)) * max_close * 0.05).toFixed(2);

  return {
    symbol,
    start: preview[0].date,
    end: preview[preview.length - 1].date,
    min_close,
    median_close,
    max_close,
    suggested_threshold, // number
    rows: preview.length,
    preview, // [{date,open,high,low,close}]
  };
}

/* ----------------------------- /backtest ------------------------------ */
/* Strategy per your UI: enter when close crosses **above** absolute threshold; hold N days */

type Trade = {
  entry_date: string;
  entry_price: number;
  exit_date: string;
  exit_price: number;
  pnl: number; // USD
  return_pct: number; // FRACTION (0–1), UI multiplies by 100
};

function computeBacktest(
  data: OHLC[],
  threshold: number,
  holdDays: number,
  initialEquity = 1000
) {
  const trades: Trade[] = [];
  const closes = data.map((d) => d.close);

  for (let i = 1; i < data.length - holdDays; i++) {
    const crossed = closes[i - 1] < threshold && closes[i] >= threshold;
    if (crossed) {
      const entry = data[i];
      const exit = data[i + holdDays];
      const pnl = +(exit.close - entry.close);
      const ret = pnl / entry.close; // fraction
      trades.push({
        entry_date: entry.date,
        entry_price: clampNum(entry.close),
        exit_date: exit.date,
        exit_price: clampNum(exit.close),
        pnl: clampNum(pnl),
        return_pct: +ret.toFixed(6),
      });
    }
  }

  // equity updates **only on exits**
  let equity = initialEquity;
  const equity_curve = [{ date: data[0]?.date ?? "", equity: clampNum(equity) }];
  for (const t of trades) {
    equity = +(equity * (1 + t.return_pct)).toFixed(2);
    equity_curve.push({ date: t.exit_date, equity });
  }

  // metrics
  const total_pnl = clampNum(equity - initialEquity);
  const wins = trades.filter((t) => t.pnl > 0).length;
  const win_rate = trades.length ? wins / trades.length : 0;

  // annualized from start/end
  let annualized_return = 0;
  if (data.length) {
    const days =
      (new Date(data[data.length - 1].date).getTime() -
        new Date(data[0].date).getTime()) /
      (1000 * 60 * 60 * 24);
    const years = days / 365;
    if (years > 0 && initialEquity > 0) {
      annualized_return = Math.pow(equity / initialEquity, 1 / years) - 1;
    }
  }

  // max drawdown (fraction)
  let peak = equity_curve.length ? equity_curve[0].equity : 0;
  let mdd = 0;
  for (const p of equity_curve) {
    if (p.equity > peak) peak = p.equity;
    const dd = peak ? (p.equity - peak) / peak : 0;
    if (dd < mdd) mdd = dd;
  }
  const max_drawdown = Math.abs(mdd);

  return {
    trades,
    equity_curve,
    metrics: {
      total_pnl: clampNum(total_pnl),
      win_rate: +win_rate.toFixed(6), // fraction
      annualized_return: +annualized_return.toFixed(6), // fraction
      max_drawdown: +max_drawdown.toFixed(6), // fraction
      final_equity: clampNum(equity),
      initial_equity: clampNum(initialEquity),
    },
  };
}

async function handleBacktest(body: any) {
  const symbol = (body?.symbol || "SPY").toString().toUpperCase();
  const start = body?.start ? String(body.start) : undefined;
  const end = body?.end ? String(body.end) : undefined;
  const threshold = Number(body?.threshold);
  const hold_days = Math.max(1, Number(body?.hold_days ?? 4));

  const data = await fetchYahooDaily(symbol, start, end);

  if (!data.length || !isFinite(threshold)) {
    return {
      symbol,
      start: start ?? "",
      end: end ?? "",
      params: { threshold: isFinite(threshold) ? threshold : 0, hold_days },
      metrics: {
        total_pnl: 0,
        win_rate: 0,
        annualized_return: 0,
        max_drawdown: 0,
        final_equity: 1000,
        initial_equity: 1000,
      },
      trades: [] as Trade[],
      equity_curve: [{ date: "", equity: 1000 }],
      price_series: [] as { date: string; close: number }[],
      note: !isFinite(threshold)
        ? "Invalid threshold"
        : "No data for symbol/date range",
    };
  }

  const bt = computeBacktest(data, threshold, hold_days, 1000);

  return {
    symbol,
    start: data[0].date,
    end: data[data.length - 1].date,
    params: { threshold, hold_days },
    metrics: bt.metrics,
    trades: bt.trades,
    equity_curve: bt.equity_curve,
    // optional price series for your price chart
    price_series: data.map((d) => ({ date: d.date, close: clampNum(d.close) })),
  };
}

/* ------------------------------- Worker ------------------------------- */

export default {
  async fetch(req: Request): Promise<Response> {
    const origin = req.headers.get("Origin") || PAGES_ORIGIN;
    try {
      const url = new URL(req.url);
      const path = url.pathname;

      if (req.method === "OPTIONS") return text("", 200, origin);
      if (req.method === "GET" && (path === "/" || path === "/status"))
        return json({ ok: true, path }, 200, origin);
      if (req.method !== "POST") return text("POST only", 405, origin);

      let body: any = {};
      try {
        body = await req.json();
      } catch {
        return text("Invalid JSON body", 400, origin);
      }

      if (path.endsWith("/peek")) return json(await handlePeek(body), 200, origin);
      if (path.endsWith("/backtest")) return json(await handleBacktest(body), 200, origin);
      return text("Unknown route. Use /peek or /backtest.", 404, origin);
    } catch (err: any) {
      return json({ detail: err?.message ?? "Internal error" }, 500, PAGES_ORIGIN);
    }
  },
} satisfies ExportedHandler;
