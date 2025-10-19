// frontend/src/components/DrawdownChart.tsx
import { memo, useMemo } from "react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Label
} from "recharts";

type Pt = { date: string; equity: number };

function computeDrawdown(equity: Pt[]) {
  const out: { date: string; dd: number }[] = [];
  let peak = equity.length ? equity[0].equity : 0;
  for (const p of equity) {
    if (p.equity > peak) peak = p.equity;
    const dd = peak > 0 ? (p.equity / peak) - 1 : 0; // ≤ 0
    out.push({ date: p.date, dd });
  }
  return out;
}

const fmtPct = (v: number) => Number.isFinite(v) ? (v * 100).toFixed(2) + "%" : "";

function DrawdownChart({ equity }: { equity: Pt[] }) {
  const data = useMemo(() => computeDrawdown(equity), [equity]);

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xl font-semibold text-emerald-400">Drawdown</h3>
        <div className="text-xs text-slate-400">Lower is worse</div>
      </div>
      <div className="w-full h-[240px]">
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ left: 64, right: 16, top: 10, bottom: 34 }}>
            <defs>
              <linearGradient id="ddFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f87171" stopOpacity={0.35}/>
                <stop offset="95%" stopColor="#f87171" stopOpacity={0.05}/>
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(148,163,184,0.15)" vertical={false}/>
            <XAxis dataKey="date" tickMargin={12} stroke="#94a3b8">
              <Label value="Date" position="bottom" offset={22} fill="#94a3b8" />
            </XAxis>
            <YAxis stroke="#94a3b8" tickFormatter={fmtPct} domain={[-1, 0]} tickMargin={8}>
              <Label value="Drawdown (%)" angle={-90} position="insideLeft" offset={10} dx={-48} dy={20} fill="#94a3b8" />
            </YAxis>
            <Tooltip
              contentStyle={{ background:"#0f172a", border:"1px solid #1f2937", borderRadius:12 }}
              formatter={(value:any) => [fmtPct(value as number), "Drawdown"]}
            />
            <Area type="monotone" dataKey="dd" stroke="#f87171" fill="url(#ddFill)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default memo(DrawdownChart);
