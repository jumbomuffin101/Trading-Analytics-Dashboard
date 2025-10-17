/** frontend/netlify/functions/netlify-backend.js */
const withCors = (res) => ({
  statusCode: res.statusCode || 200,
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    ...(res.headers || {}),
  },
  body: res.body || "",
});

exports.handler = async (event) => {
  console.log("method:", event.httpMethod, "path:", event.path);

  if (event.httpMethod === "OPTIONS") return withCors({ statusCode: 200, body: "" });

  const path = (event.path || "").replace(/\/+$/, "");
  const isPeek = /(?:^|\/)peek$/.test(path);
  const isBacktest = /(?:^|\/)backtest$/.test(path);

  let body = {};
  try { if (event.body) body = JSON.parse(event.body); } catch {}

  if (isPeek && event.httpMethod === "POST") {
    const symbol = String(body.symbol ?? "SPY").toUpperCase();
    const start  = String(body.start ?? "2024-01-01");
    const end    = String(body.end   ?? "2024-12-31");
    const preview = Array.from({ length: 5 }).map((_, i) => {
      const d = new Date(start); d.setDate(d.getDate() + i * 7);
      return { date: d.toISOString().slice(0,10), open: 100+i, high: 101+i, low: 99+i, close: 100+i };
    });
    return withCors({
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol, start, end,
        min_close: 99, median_close: 100, max_close: 101,
        suggested_threshold: 100.00, rows: preview.length, preview,
        note: "Netlify function placeholder /peek"
      }),
    });
  }

  if (isBacktest && event.httpMethod === "POST") {
    const symbol = String(body.symbol ?? "SPY").toUpperCase();
    const start  = String(body.start ?? "2024-01-01");
    const end    = String(body.end   ?? "2024-12-31");
    const threshold = Number.isFinite(body.threshold) ? Number(body.threshold) : 100;
    const hold_days = Number.isFinite(body.hold_days) ? Number(body.hold_days) : 4;

    const dates = []; const equities = [];
    const s = new Date(start);
    for (let i=0;i<30;i++){ const d=new Date(s); d.setDate(d.getDate()+i*10);
      dates.push(d.toISOString().slice(0,10)); equities.push(100000 + i*200); }
    const equity_curve = dates.map((date,i)=>({date,equity:equities[i]}));
    const price_series = dates.map((date,i)=>({date,close:95+i*0.5}));

    const trades = [
      { entry_date: dates[2],  entry_price: 100, exit_date: dates[6],  exit_price: 102, pnl: 1187.26, return_pct: 0.0118 },
      { entry_date: dates[10], entry_price: 101, exit_date: dates[14], exit_price:  99, pnl: -635.70, return_pct: -0.0063 },
    ];
    const metrics = {
      total_pnl: trades.reduce((s,t)=>s+t.pnl,0),
      win_rate: trades.filter(t=>t.pnl>0).length / trades.length,
      annualized_return: 0.0408,
      max_drawdown: -0.0132,
      final_equity: equities.at(-1) + trades.reduce((s,t)=>s+t.pnl,0),
      initial_equity: equities[0],
    };

    return withCors({
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol, start, end, params:{threshold, hold_days},
        metrics, trades, equity_curve, price_series,
        note: "Netlify function placeholder /backtest"
      }),
    });
  }

  return withCors({
    statusCode: 404,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ error: "Route not found", path }),
  });
};
