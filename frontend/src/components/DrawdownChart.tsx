import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
  ReferenceDot,
  Label,
} from "recharts";

type EqPt = { date: string; equity: number };

export default function DrawdownChart({ equity }: { equity: EqPt[] }) {
  // Build underwater series: drawdown % from running peak
  let peak = 0;
  const data = equity.map((p) => {
    if (p.equity > peak) peak = p.equity;
    const ddPct = peak ? (p.equity / peak - 1) * 100 : 0; // negative or 0
    return { date: p.date, dd: +ddPct.toFixed(3) };
  });

  const minPt =
    data.length > 0
      ? data.reduce((a, b) => (b.dd < a.dd ? b : a), data[0])
      : { date: "", dd: 0 };

  // Time to recover from the worst DD (to first return to 0)
  let recoveryText = "Not recovered within sample.";
  if (minPt.date) {
    const startIdx = data.findIndex((d) => d.date === minPt.date);
    const recIdx = data.slice(startIdx).findIndex((d) => d.dd >= -0.0001);
    if (recIdx >= 0) {
      const recDate = data[startIdx + recIdx].date;
      const days =
        (new Date(recDate).getTime() - new Date(minPt.date).getTime()) /
        (1000 * 60 * 60 * 24);
      recoveryText = `${Math.round(days)} days to recover from worst drawdown.`;
    }
  }

  const yMin = Math.min(-2, Math.floor(Math.min(...data.map((d) => d.dd), 0) - 2));
  const yMax = 0;

  return (
    <div className="card p-6 mt-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-2xl font-bold tracking-tight text-emerald-400">Drawdown</h3>
        <div className="text-xs text-slate-400">Lower is worse</div>
      </div>

      <div className="w-full h-[340px]">
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ left: 68, right: 16, top: 10, bottom: 38 }}>
            <defs>
              <linearGradient id="ddFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(148,163,184,0.15)" vertical={false} />
            <XAxis
              dataKey="date"
              tickMargin={12}
              stroke="#94a3b8"
              tickFormatter={(iso) =>
                new Intl.DateTimeFormat("en-US", { year: "numeric", month: "2-digit" }).format(
                  new Date(iso)
                )
              }
            >
              <Label value="Date" position="bottom" offset={24} fill="#94a3b8" />
            </XAxis>
            <YAxis
              domain={[yMin, yMax]}
              stroke="#94a3b8"
              tickMargin={10}
              tickFormatter={(v) => `${v.toFixed(0)}%`}
            >
              <Label
                value="Drawdown (%)"
                angle={-90}
                position="insideLeft"
                offset={14}
                dx={-60}
                dy={30}
                fill="#94a3b8"
              />
            </YAxis>
            <Tooltip
              contentStyle={{
                background: "#0f172a",
                border: "1px solid #1f2937",
                borderRadius: 12,
              }}
              formatter={(value: any) => [`${(value as number).toFixed(2)}%`, "Drawdown"]}
            />
            <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />
            <Area type="monotone" dataKey="dd" stroke="#ef4444" fill="url(#ddFill)" strokeWidth={2} />
            {minPt.date ? (
              <ReferenceDot
                x={minPt.date}
                y={minPt.dd}
                r={4}
                fill="#ef4444"
                stroke="#7f1d1d"
              />
            ) : null}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 text-xs text-slate-400">
        Max drawdown: <span className="text-rose-300">{minPt.dd.toFixed(2)}%</span>
        {minPt.date ? ` on ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(minPt.date))}.` : "."}
        {" "}{recoveryText}
      </div>
    </div>
  );
}
