// cloudfare-api/src/index.ts
// Returns payloads that match the frontend's original expectations exactly,
// but adds three strategies with data-adaptive defaults so trade counts
// naturally vary with symbol/date range volatility and trend.

const PAGES_ORIGIN = "https://jumbomuffin101.github.io";

/* --------------------------- Helpers: responses --------------------------- */

const json = (data: unknown, status = 200, origin = PAGES_ORIGIN) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": origin,
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "POST, OPTIONS, GET",
      vary: "origin",
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
      vary: "origin",
    },
  });

/* --------------------------- Types + small utils -------------------------- */

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

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/* -------------------- Robust candles (Stooq → Yahoo) --------------------- */

async function fetchStooqCsv(host: "stooq.com" | "stooq.pl", symbolLower: string): Promise<string> {
  const url = `https://${host}/q/d/l/?s=${encodeURIComponent(symbolLower)}&i=d`;
  const r = await fetch(url, { headers: { accept: "text/csv" } });
  if (!r.ok) return "";
  return await r.text();
}

function parseStooqCsv(csv: string): OHLC[] {
  if (!csv) return [];
  const lines = csv.trim().split(/\r?\n/);
  if (!/^Date,Open,High,Low,Close/i.test(lines[0] ?? "")) return [];
  const rows = lines.slice(1).map((l) => l.split(","));
  const out: OHLC[] = [];
  for (const cols of rows) {
    const [date, o, h, l, c] = cols;
    const open = Number(o), high = Number(h), low = Number(l), close = Number(c);
    if (![open, high, low, close].every(Number.isFinite)) continue;
    out.push({ date, open, high, low, close });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

// Try Stooq with .us then plain, on both .com and .pl
async function tryStooqAll(symbol: string, start?: string, end?: string): Promise<{ data: OHLC[]; source?: string }> {
  const variants = [
    { host: "stooq.com" as const, sym: `${symbol.toLowerCase()}.us` },
    { host: "stooq.com" as const, sym: symbol.toLowerCase() },
    { host: "stooq.pl" as const, sym: `${symbol.toLowerCase()}.us` },
    { host: "stooq.pl" as const, sym: symbol.toLowerCase() },
  ];
  for (const v of variants) {
    try {
      const csv = await fetchStooqCsv(v.host, v.sym);
      let data = parseStooqCsv(csv);
      if (start) data = data.filter((d) => d.date >= start);
      if (end) data = data.filter((d) => d.date <= end);
      if (data.length) return { data, source: `stooq:${v.host}/${v.sym}` };
    } catch {
      // continue
    }
  }
  return { data: [] };
}

function buildYahooUrl(symbol: string, start?: string, end?: string, host = "query1.finance.yahoo.com") {
  if (start && end) {
    const p1 = Math.floor(new Date(`${start}T00:00:00Z`).getTime() / 1000);
    const p2 = Math.floor(new Date(`${end}T23:59:59Z`).getTime() / 1000);
    return `https://${host}/v8/finance/chart/${encodeURIComponent(
      symbol
    )}?period1=${p1}&period2=${p2}&interval=1d&includePrePost=false&events=div%2Csplit`;
  }
  return `https://${host}/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?range=6mo&interval=1d&includePrePost=false&events=div%2Csplit`;
}

async function tryYahoo(symbol: string, start?: string, end?: string, host = "query1.finance.yahoo.com") {
  const url = buildYahooUrl(symbol, start, end, host);
  const headers = {
    accept: "application/json",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  };
  const r = await fetch(url, { headers });
  if (!r.ok) return { data: [] as OHLC[] };
  const j = (await r.json()) as YahooChartResponse;
  const res = j?.chart?.result?.[0];
  const ts: number[] = res?.timestamp ?? [];
  const q = res?.indicators?.quote?.[0] ?? {};
  const opens = q?.open ?? [];
  const highs = q?.high ?? [];
  const lows = q?.low ?? [];
  const closes = q?.close ?? [];
  const out: OHLC[] = [];
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    const o = Number(opens[i]), h = Number(highs[i]), l = Number(lows[i]), c = Number(closes[i]);
    if (!Number.isFinite(t) || ![o, h, l, c].every(Number.isFinite)) continue;
    out.push({
      date: new Date(t * 1000).toISOString().slice(0, 10),
      open: o, high: h, low: l, close: c,
    });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return { data: out, source: `yahoo:${host}` };
}

async function fetchCandles(symbol: string, start?: string, end?: string): Promise<{ data: OHLC[]; source?: string }> {
  // 1) Stooq (serverless friendly)
  let r = await tryStooqAll(symbol, start, end);
  if (r.data.length) return r;

  // 2) Yahoo primary
  r = await tryYahoo(symbol, start, end, "query1.finance.yahoo.com");
  if (r.data.length) return r;

  // 3) Yahoo mirror
  r = await tryYahoo(symbol, start, end, "query2.finance.yahoo.com");
  return r;
}

/* -------------------------------- /peek --------------------------------- */

async function handlePeek(body: any) {
  const symbol = (body?.symbol || "SPY").toString().toUpperCase();
  const start = body?.start ? String(body.start) : undefined;
  const end = body?.end ? String(body.end) : undefined;

  const { data: preview, source: source_used } = await fetchCandles(symbol, start, end);

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
      source_used: source_used ?? "none",
    };
  }

  const closes = preview.map((p) => p.close);
  const min_close = clampNum(Math.min(...closes));
  const max_close = clampNum(Math.max(...closes));
  const median_close = clampNum(median(closes));
  // Simple suggested threshold between median and max
  const suggested_threshold = clampNum(median_close + (max_close - median_close) * 0.25, 2);

  return {
    symbol,
    start: preview[0].date,
    end: preview[preview.length - 1].date,
    min_close,
    median_close,
    max_close,
    suggested_threshold,
    rows: preview.length,
    preview,
    source_used,
  };
}

/* ------------------------------ Strategy core ---------------------------- */

type Trade = {
  entry_date: string;
  entry_price: number;
  exit_date: string;
  exit_price: number;
  pnl: number;          // USD
  return_pct: number;   // fraction
};

type Metrics = {
  total_pnl: number; win_rate: number; annualized_return: number;
  max_drawdown: number; final_equity: number; initial_equity: number;
};

type StrategyName = "legacy_absolute" | "breakout_pct" | "breakout_atr" | "mean_reversion";

type CommonParams = {
  allow_long?: boolean;
  allow_short?: boolean;
  take_profit_pct?: number;
  stop_loss_pct?: number;
  max_hold_days?: number;
  cooldown_days?: number;
  allow_immediate_reentry?: boolean;
};

type BreakoutPctParams = CommonParams & {
  lookback?: number;
  threshold_pct?: number; // e.g. 0.003 => 0.3%
};

type BreakoutAtrParams = CommonParams & {
  lookback?: number;
  atr_k?: number; // multiplier on ATR
};

type MeanRevParams = CommonParams & {
  lookback?: number;   // SMA window
  drop_pct?: number;   // distance from SMA to trigger
};

function rmax(a: number[], w: number, i: number){const s=Math.max(0,i-w);let m=-Infinity;for(let k=s;k<i;k++)m=Math.max(m,a[k]);return m;}
function rmin(a: number[], w: number, i: number){const s=Math.max(0,i-w);let m=Infinity;for(let k=s;k<i;k++)m=Math.min(m,a[k]);return m;}
function sma(a: number[], w: number, i: number){const s=Math.max(0,i-w+1);let sum=0, n=0;for(let k=s;k<=i;k++){sum+=a[k];n++;}return n?sum/n:NaN;}
function atrWilder(b: OHLC[], p=14){
  const tr:number[]=[];
  for (let i=0;i<b.length;i++){
    const pc=i?b[i-1].close:b[i].close; const {high,low}=b[i];
    tr.push(Math.max(high-low,Math.abs(high-pc),Math.abs(low-pc)));
  }
  const atr:number[]=[]; let s=0;
  for (let i=0;i<tr.length;i++){
    if(i<p){ s+=tr[i]; atr.push(i===p-1?s/p:NaN); }
    else if(i===p){ s+=tr[i]-tr[i-p]; atr.push(s/p); }
    else { const prev=atr[i-1]; atr.push((prev*(p-1)+tr[i])/p); }
  }
  return atr;
}

// Build equity/metrics so UI stays identical across strategies
function buildMetrics(trades: Trade[], data: OHLC[], initialEquity=1000){
  let equity = initialEquity;
  const equity_curve = [{ date: data[0]?.date ?? "", equity: clampNum(equity) }];
  for (const t of trades) {
    equity = +(equity * (1 + t.return_pct)).toFixed(2);
    equity_curve.push({ date: t.exit_date, equity });
  }
  const total_pnl = clampNum(equity - initialEquity);
  const wins = trades.filter(t => t.pnl > 0).length;
  const win_rate = trades.length ? wins / trades.length : 0;
  let annualized_return = 0;
  if (data.length > 1){
    const days = (new Date(data[data.length-1].date).getTime() - new Date(data[0].date).getTime())/(1000*60*60*24);
    const years = days/365;
    if (years > 0) annualized_return = Math.pow(equity/initialEquity, 1/years) - 1;
  }
  let peak = equity_curve[0]?.equity ?? 0, mdd = 0;
  for (const p of equity_curve){
    if (p.equity > peak) peak = p.equity;
    const dd = peak ? (p.equity - peak) / peak : 0;
    if (dd < mdd) mdd = dd;
  }
  const metrics: Metrics = {
    total_pnl: clampNum(total_pnl),
    win_rate: +win_rate.toFixed(6),
    annualized_return: +annualized_return.toFixed(6),
    max_drawdown: +Math.abs(mdd).toFixed(6),
    final_equity: clampNum(equity),
    initial_equity: clampNum(initialEquity),
  };
  return { equity_curve, metrics };
}

/* ---------------------------- Strategies (3) ----------------------------- */

// 1) Legacy absolute-threshold cross from below (your original)
function runLegacyAbsolute(data: OHLC[], threshold: number, holdDays: number): Trade[] {
  const trades: Trade[] = [];
  const closes = data.map(d => d.close);
  for (let i=1;i<data.length - holdDays;i++){
    const crossed = closes[i-1] < threshold && closes[i] >= threshold;
    if (crossed){
      const entry = data[i], exit = data[i+holdDays];
      const pnl = +(exit.close - entry.close);
      const ret = pnl / entry.close;
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
  return trades;
}

// 2) Breakout (percent or ATR). Adaptive defaults from data volatility.
function runBreakoutPct(data: OHLC[], raw: BreakoutPctParams): Trade[] {
  const trades: Trade[] = [];
  const closes = data.map(d => d.close);
  const lookback = Math.max(5, Math.min(200, raw.lookback ?? 20));

  // Data-adaptive: estimate daily volatility ~ avg(|ret|)
  const rets = [];
  for (let i=1;i<closes.length;i++) rets.push(Math.abs((closes[i]-closes[i-1])/closes[i-1]));
  const volPct = Math.max(0.001, Math.min(0.05, mean(rets))); // clamp 0.1%–5%
  const threshold_pct = Math.max(0.001, Math.min(0.02, raw.threshold_pct ?? (0.6 * volPct))); // 0.6×vol

  const allow_long  = raw.allow_long  ?? true;
  const allow_short = raw.allow_short ?? true;
  const max_hold_days = Math.max(1, raw.max_hold_days ?? 5);
  const take_profit_pct = raw.take_profit_pct ?? 0.02;
  const stop_loss_pct   = raw.stop_loss_pct   ?? 0.01;
  const cooldown_days = Math.max(0, raw.cooldown_days ?? 0);
  const allow_immediate_reentry = raw.allow_immediate_reentry ?? true;

  let pos: null | { side:"long"|"short"; entryIdx:number; entryPx:number } = null;
  let lastExit = -9999;

  for (let i=1;i<data.length;i++){
    const c = closes[i];

    // exits
    if (pos){
      const held = i - pos.entryIdx;
      const ret = (c - pos.entryPx) / pos.entryPx * (pos.side==="long"?1:-1);
      let exit = false;
      if (held >= max_hold_days) exit = true;
      if (!exit && take_profit_pct && ret >= take_profit_pct) exit = true;
      if (!exit && stop_loss_pct   && ret <= -stop_loss_pct)   exit = true;
      if (exit){
        trades.push({
          entry_date: data[pos.entryIdx].date,
          entry_price: clampNum(pos.entryPx),
          exit_date: data[i].date,
          exit_price: clampNum(c),
          pnl: clampNum((c - pos.entryPx) * (pos.side==="long"?1:-1)),
          return_pct: +ret.toFixed(6),
        });
        pos = null;
        lastExit = i;
      }
    }

    const canEnter = !pos && (allow_immediate_reentry || i > lastExit) && (cooldown_days===0 || i - lastExit > cooldown_days);
    if (!canEnter) continue;

    const up = rmax(closes, lookback, i);
    const dn = rmin(closes, lookback, i);
    let goL = false, goS = false;
    if (allow_long  && isFinite(up) && c > up * (1 + threshold_pct)) goL = true;
    if (allow_short && isFinite(dn) && c < dn * (1 - threshold_pct)) goS = true;

    if (goL) pos = { side:"long", entryIdx:i, entryPx:c };
    else if (goS) pos = { side:"short", entryIdx:i, entryPx:c };
  }

  return trades;
}

function runBreakoutAtr(data: OHLC[], raw: BreakoutAtrParams): Trade[] {
  const trades: Trade[] = [];
  const closes = data.map(d => d.close);
  const lookback = Math.max(10, Math.min(100, raw.lookback ?? 20));
  const atr = atrWilder(data, lookback);

  // Adaptive ATR multiple: scale slightly with realized vol so calmer markets still trigger
  const avgAtr = mean(atr.filter(Number.isFinite));
  const avgPx  = mean(closes);
  const baseK  = 0.5;
  const volAdj = avgPx > 0 ? Math.max(0.3, Math.min(0.8, (avgAtr/avgPx) / 0.01)) : 1; // normalize to ~1% ATR
  const atr_k = raw.atr_k ?? +(baseK * volAdj).toFixed(2);

  const allow_long  = raw.allow_long  ?? true;
  const allow_short = raw.allow_short ?? true;
  const max_hold_days = Math.max(1, raw.max_hold_days ?? 5);
  const take_profit_pct = raw.take_profit_pct ?? 0.02;
  const stop_loss_pct   = raw.stop_loss_pct   ?? 0.01;
  const cooldown_days = Math.max(0, raw.cooldown_days ?? 0);
  const allow_immediate_reentry = raw.allow_immediate_reentry ?? true;

  let pos: null | { side:"long"|"short"; entryIdx:number; entryPx:number } = null;
  let lastExit = -9999;

  for (let i=1;i<data.length;i++){
    const c = closes[i];

    if (pos){
      const held = i - pos.entryIdx;
      const ret = (c - pos.entryPx) / pos.entryPx * (pos.side==="long"?1:-1);
      let exit=false;
      if (held >= max_hold_days) exit = true;
      if (!exit && take_profit_pct && ret >= take_profit_pct) exit = true;
      if (!exit && stop_loss_pct   && ret <= -stop_loss_pct)   exit = true;
      if (exit){
        trades.push({
          entry_date: data[pos.entryIdx].date, entry_price: clampNum(pos.entryPx),
          exit_date: data[i].date, exit_price: clampNum(c),
          pnl: clampNum((c - pos.entryPx) * (pos.side==="long"?1:-1)),
          return_pct: +ret.toFixed(6),
        });
        pos = null; lastExit = i;
      }
    }

    const canEnter = !pos && (allow_immediate_reentry || i > lastExit) && (cooldown_days===0 || i - lastExit > cooldown_days);
    if (!canEnter) continue;

    const up = rmax(closes, lookback, i);
    const dn = rmin(closes, lookback, i);
    const a  = atr[i];

    let goL=false, goS=false;
    if (isFinite(a)){
      if (allow_long  && isFinite(up) && c > up + atr_k * a) goL = true;
      if (allow_short && isFinite(dn) && c < dn - atr_k * a) goS = true;
    }

    if (goL) pos = { side:"long", entryIdx:i, entryPx:c };
    else if (goS) pos = { side:"short", entryIdx:i, entryPx:c };
  }

  return trades;
}

// 3) Mean Reversion: enter after a drop below SMA by drop_pct; exit on mean touch or 1-day hold.
// Defaults are intentionally turnover-friendly (drop_pct small, hold 1).
function runMeanReversion(data: OHLC[], raw: MeanRevParams): Trade[] {
  const trades: Trade[] = [];
  const closes = data.map(d => d.close);
  const lookback = Math.max(5, Math.min(100, raw.lookback ?? 20));

  // Adaptive drop %: 0.5–2% typical depending on realized vol
  const rets = [];
  for (let i=1;i<closes.length;i++) rets.push(Math.abs((closes[i]-closes[i-1])/closes[i-1]));
  const volPct = Math.max(0.001, Math.min(0.05, mean(rets)));
  const drop_pct = Math.max(0.003, Math.min(0.025, raw.drop_pct ?? (0.8 * volPct))); // 0.8×vol

  const allow_long  = raw.allow_long  ?? true;
  const allow_short = raw.allow_short ?? true;
  const max_hold_days = Math.max(1, raw.max_hold_days ?? 1); // <- default 1 day as requested
  const take_profit_pct = raw.take_profit_pct ?? 0;  // TP/SL optional for MR; mean touch is primary exit
  const stop_loss_pct   = raw.stop_loss_pct   ?? 0;
  const cooldown_days = Math.max(0, raw.cooldown_days ?? 0);
  const allow_immediate_reentry = raw.allow_immediate_reentry ?? true;

  let pos: null | { side:"long"|"short"; entryIdx:number; entryPx:number } = null;
  let lastExit = -9999;

  for (let i=lookback;i<data.length;i++){
    const c = closes[i];
    const m = sma(closes, lookback, i);

    // exits
    if (pos){
      const held = i - pos.entryIdx;
      const ret = (c - pos.entryPx) / pos.entryPx * (pos.side==="long"?1:-1);
      let exit = false;

      // mean-touch exit: long exits when price >= SMA; short exits when price <= SMA
      if (pos.side === "long"  && c >= m) exit = true;
      if (pos.side === "short" && c <= m) exit = true;

      if (!exit && max_hold_days && held >= max_hold_days) exit = true;
      if (!exit && take_profit_pct && ret >= take_profit_pct) exit = true;
      if (!exit && stop_loss_pct   && ret <= -stop_loss_pct)   exit = true;

      if (exit){
        trades.push({
          entry_date: data[pos.entryIdx].date,
          entry_price: clampNum(pos.entryPx),
          exit_date: data[i].date,
          exit_price: clampNum(c),
          pnl: clampNum((c - pos.entryPx) * (pos.side==="long"?1:-1)),
          return_pct: +ret.toFixed(6),
        });
        pos = null; lastExit = i;
      }
    }

    const canEnter = !pos && (allow_immediate_reentry || i > lastExit) && (cooldown_days===0 || i - lastExit > cooldown_days);
    if (!canEnter || !isFinite(m)) continue;

    let goL=false, goS=false;
    if (allow_long  && c <= m * (1 - drop_pct)) goL = true;           // dip below SMA by drop_pct
    if (allow_short && c >= m * (1 + drop_pct)) goS = true;           // rip above SMA by drop_pct

    if (goL) pos = { side:"long", entryIdx:i, entryPx:c };
    else if (goS) pos = { side:"short", entryIdx:i, entryPx:c };
  }

  return trades;
}

/* ----------------------- Legacy wrapper (unchanged) ---------------------- */

function computeBacktestLegacyForResponse(
  data: OHLC[],
  threshold: number,
  holdDays: number,
  initialEquity = 1000
) {
  const trades = runLegacyAbsolute(data, threshold, holdDays);
  const { equity_curve, metrics } = buildMetrics(trades, data, initialEquity);
  return { trades, equity_curve, metrics };
}

/* ------------------------- Backtest handler (all) ------------------------ */

async function handleBacktest(body: any) {
  const symbol = (body?.symbol || "SPY").toString().toUpperCase();
  const start = body?.start ? String(body.start) : undefined;
  const end = body?.end ? String(body.end) : undefined;

  // legacy inputs (still supported)
  const threshold = Number(body?.threshold);
  const hold_days = Math.max(1, Number(body?.hold_days ?? 4));

  // new param block
  const params = (body?.params ?? {}) as {
    strategy?: StrategyName;
    // strategy-specific fields get forwarded as-is
    [k: string]: any;
  };

  const { data, source: source_used } = await fetchCandles(symbol, start, end);

  if (!data.length) {
    return {
      symbol,
      start: start ?? "",
      end: end ?? "",
      params: { threshold: isFinite(threshold) ? threshold : 0, hold_days, ...params },
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
      note: "No data for symbol/date range",
      source_used: source_used ?? "none",
    };
  }

  // Choose strategy. If none provided, keep legacy to avoid breaking UI.
  const strategy: StrategyName = (params.strategy as StrategyName) ?? "legacy_absolute";

  let trades: Trade[] = [];
  if (strategy === "legacy_absolute") {
    trades = runLegacyAbsolute(data, threshold, hold_days);
  } else if (strategy === "breakout_pct") {
    trades = runBreakoutPct(data, params as BreakoutPctParams);
  } else if (strategy === "breakout_atr") {
    trades = runBreakoutAtr(data, params as BreakoutAtrParams);
  } else if (strategy === "mean_reversion") {
    trades = runMeanReversion(data, params as MeanRevParams);
  } else {
    // fallback to legacy if unknown tag
    trades = runLegacyAbsolute(data, threshold, hold_days);
  }

  const { equity_curve, metrics } = buildMetrics(trades, data, 1000);

  return {
    symbol,
    start: data[0].date,
    end: data[data.length - 1].date,
    params: { threshold: isFinite(threshold) ? threshold : 0, hold_days, ...params },
    metrics,
    trades,
    equity_curve,
    // optional price series for your price chart
    price_series: data.map((d) => ({ date: d.date, close: clampNum(d.close) })),
    source_used,
  };
}

/* ------------------------------- Worker ---------------------------------- */

const BUILD = "v-strategies-adaptive-3"; // bump to verify deploy
function about(origin: string) {
  return json({ ok: true, build: BUILD, service: "ssmif-api" }, 200, origin);
}

export default {
  async fetch(req: Request): Promise<Response> {
    const origin = req.headers.get("Origin") || PAGES_ORIGIN;
    try {
      const url = new URL(req.url);
      const path = url.pathname;

      if (req.method === "OPTIONS") return text("", 200, origin);
      if (req.method === "GET" && path === "/about") return about(origin);
      if (req.method === "GET" && (path === "/" || path === "/status"))
        return json({ ok: true, path }, 200, origin);
      if (req.method !== "POST") return text("POST only", 405, origin);

      let body: any = {};
      try { body = await req.json(); }
      catch { return text("Invalid JSON body", 400, origin); }

      if (path.endsWith("/peek"))     return json(await handlePeek(body), 200, origin);
      if (path.endsWith("/backtest")) return json(await handleBacktest(body), 200, origin);
      return text("Unknown route. Use /peek or /backtest.", 404, origin);
    } catch (err: any) {
      return json({ detail: err?.message ?? "Internal error" }, 500, PAGES_ORIGIN);
    }
  },
} satisfies ExportedHandler;
