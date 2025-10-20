// src/components/DrawdownChart.tsx
import React, { useMemo } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ReferenceDot, Label, ResponsiveContainer
} from "recharts";

type EqPoint = { date: string; equity: number };

export default function DrawdownChart({ equity }: { equity: EqPoint[] }) {
  const data = useMemo(() => {
    let peak = equity?.length ? equity[0].equity : 0;
    return (equity || []).map((e) => {
      peak = Math.max(peak, e.equity);
      const dd = peak > 0 ? (e.equity / peak - 1) : 0;
      return { date: e.date, dd };
    });
  }, [equity]);

  const minIdx = useMemo(() => {
    if (!data.length) return -1;
    let idx = 0, v = data[0].dd;
    for (let i = 1; i < data.length; i++) if (data[i].dd < v) { v = data[i].dd; idx = i; }
    return idx;
  }, [data]);

  const minPt = data[minIdx];

  const fmtPct = (v: number) => (Number.isFinite(v) ? (v * 100).toFixed(2) + "%" : "");
  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(new Date(iso));

  return (
    <div className="card p-6">
      <h3 className="text-2xl font-bold tracking-tight text-[var(--accent)] mb-2">Drawdown</h3>

      <div className="w-full h-[360px]">
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ left: 64, right: 16, top: 10, bottom: 36 }}>
            <defs>
              <linearGradient id="ddFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--down)" stopOpacity={0.25} />
                <stop offset="95%" stopColor="var(--down)" stopOpacity={0.05} />
              </linearGradient>
            </defs>

            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="date" tickMargin={12} stroke="var(--muted)"
                   tickFormatter={(d) => fmtDate(d)}>
              <Label value="Date" position="bottom" offset={20} fill="var(--muted)" />
            </XAxis>
            <YAxis stroke="var(--muted)" tickFormatter={fmtPct} tickMargin={10} domain={['auto', 0]}>
              <Label value="Drawdown (%)" angle={-90} position="insideLeft" offset={14} dx={-50} dy={30} fill="var(--muted)" />
            </YAxis>

            {/* 0% reference line */}
            <ReferenceLine y={0} stroke="var(--muted)" strokeDasharray="4 4" />

            <Tooltip
              contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--text)" }}
              formatter={(v: any) => [fmtPct(v as number), "Drawdown"]}
              labelFormatter={(l) => fmtDate(String(l))}
            />

            <Area type="monotone" dataKey="dd" stroke="var(--down)" fill="url(#ddFill)" strokeWidth={2} />
            {minPt && (
              <ReferenceDot x={minPt.date} y={minPt.dd} r={4} fill="var(--down)" stroke="rgba(0,0,0,0.5)" />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {minPt && (
        <div className="mt-3 text-xs text-[var(--muted)]">
          Max drawdown: <span className="text-down">{fmtPct(minPt.dd)}</span> on {fmtDate(minPt.date)}.
        </div>
      )}
    </div>
  );
}
