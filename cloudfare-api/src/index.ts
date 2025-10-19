// cloudfare-api/src/index.ts

// Allow your GitHub Pages domain (no path)
const ALLOW_ORIGIN = "https://jumbomuffin101.github.io";

function corsHeaders() {
  return {
    "access-control-allow-origin": ALLOW_ORIGIN,
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "POST, OPTIONS, GET",
    "vary": "origin",
  };
}

function asJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders() },
  });
}

function asText(msg: string, status = 200) {
  return new Response(msg, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", ...corsHeaders() },
  });
}

function makePreview(symbol: string) {
  // tiny synthetic OHLC series so the UI has numbers to render
  const today = new Date();
  const days = 20;
  const preview = Array.from({ length: days }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (days - 1 - i));
    const base = 480 + Math.sin(i / 3) * 8 + i * 0.4; // some movement
    const open = +(base + Math.random() * 2 - 1).toFixed(2);
    const close = +(base + Math.random() * 2 - 1).toFixed(2);
    const high = +Math.max(open, close, base + 3).toFixed(2);
    const low  = +Math.min(open, close, base - 3).toFixed(2);
    return {
      date: d.toISOString().slice(0, 10),
      open, high, low, close
    };
  });

  const closes = preview.map(p => p.close).sort((a,b)=>a-b);
  const min_close = closes[0];
  const max_close = closes[closes.length - 1];
  const median_close = closes[Math.floor(closes.length / 2)];
  const suggested_threshold = +((median_close - min_close) / (max_close - min_close + 1e-6)).toFixed(2);

  return {
    symbol,
    start: preview[0].date,
    end: preview[preview.length - 1].date,
    min_close,
    median_close,
    max_close,
    suggested_threshold,
    rows: preview.length,
    preview
  };
}

function makeBacktest(symbol: string) {
  // simple synthetic trades + equity so UI has numbers
  const trades = [
    { entry_date: "2025-09-01", entry_price: 470.12, exit_date: "2025-09-05", exit_price: 478.45 },
    { entry_date: "2025-09-10", entry_price: 480.00, exit_date: "2025-09-17", exit_price: 474.90 },
    { entry_date: "2025-10-01", entry_price: 482.30, exit_date: "2025-10-08", exit_price: 490.10 },
  ].map(t => {
    const pnl = +(t.exit_price - t.entry_price).toFixed(2);
    const return_pct = +(((t.exit_price - t.entry_price) / t.entry_price) * 100).toFixed(2);
    return { ...t, pnl, return_pct };
  });

  const equity_start = 1000; // you asked to show movement around 1,000
  const equity_curve = trades.reduce<{ date: string; equity: number; }[]>((acc, t) => {
    const prev = acc.length ? acc[acc.length - 1].equity : equity_start;
    const next = +(prev * (1 + t.return_pct / 100)).toFixed(2);
    acc.push({ date: t.exit_date, equity: next });
    return acc;
  }, [{ date: trades[0].entry_date, equity: equity_start }]);

  const best_trade = trades.reduce((a,b)=> (a.return_pct > b.return_pct ? a : b));
  const worst_trade = trades.reduce((a,b)=> (a.return_pct < b.return_pct ? a : b));

  return {
    symbol,
    start: trades[0].entry_date,
    end: trades[trades.length-1].exit_date,
    equity_start,
    equity_end: equity_curve[equity_curve.length-1].equity,
    equity_curve,
    trades,
    best_trade,
    worst_trade,
    total_trades: trades.length,
    win_rate_pct: +((trades.filter(t=>t.pnl>0).length / trades.length) * 100).toFixed(2),
  };
}

export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    // Health endpoint
    if (req.method === "GET" && (path === "/" || path === "/status")) {
      return asJson({ ok: true, ts: Date.now(), path });
    }

    if (req.method !== "POST") {
      return asText("POST only", 405);
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return asText("Invalid JSON body", 400);
    }

    const symbol = typeof body?.symbol === "string" ? body.symbol : "SPY";

    if (path.endsWith("/peek")) {
      return asJson(makePreview(symbol));
    }

    if (path.endsWith("/backtest")) {
      return asJson(makeBacktest(symbol));
    }

    return asText("Unknown route. Use /peek or /backtest.", 404);
  },
} satisfies ExportedHandler;
