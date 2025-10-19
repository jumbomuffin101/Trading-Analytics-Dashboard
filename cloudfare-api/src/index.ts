// src/index.ts

type Json = Record<string, unknown> | unknown[];

const ORIGIN = "https://jumbomuffin101.github.io/ssmif-quant-dev/";
function corsHeaders(origin = ORIGIN) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "POST, OPTIONS, GET",
  };
}

const json = (data: Json, status = 200, origin = "*") =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      ...corsHeaders(origin),
    },
  });

const text = (msg: string, status = 200, origin = "*") =>
  new Response(msg, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      ...corsHeaders(origin),
    },
  });

export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // 1) CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders("*") });
    }

    // 2) Health check
    if (req.method === "GET" && path === "/") {
      return text("API up");
    }

    // 3) Enforce POST for data routes
    if (req.method !== "POST") {
      return text("POST only", 405);
    }

    // 4) Parse JSON body
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return text("Invalid JSON body", 400);
    }

    // 5) Routes
    if (path.endsWith("/peek")) {
      // TODO: implement your real preview logic here
      return json({ route: "peek", received: body });
    }

    if (path.endsWith("/backtest")) {
      // TODO: run your strategy & return its results here
      return json({ route: "backtest", received: body });
    }

    return text("Unknown route. Use /peek or /backtest.", 404);
  },
} satisfies ExportedHandler;
