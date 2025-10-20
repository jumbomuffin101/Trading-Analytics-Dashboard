import React, { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
  ReferenceLine,
  Label,
  ResponsiveContainer,
} from "recharts";

type EquityPt = { date: string; equity: number };

type Band = {
  /** Negative number (e.g., -0.10 for -10%) where the band ends. */
  limit: number;
  label: string;
  /** Any CSS color (use your CSS vars for theme). */
  fill: string;
  /** Outline color for the threshold line at this limit (optional). */
  line?: string;
};

/**
 * DrawdownChart with visual severity bands.
 * Drawdown values are ≤ 0 (0 to -100%), plotted as percentages on Y axis.
 */
export default function DrawdownChart({
  equity,
  bands = [
    // from 0 to -10%  -> "OK"
    { limit: -0.10, label: "OK (≤10%)", fill: "rgba(0,255,106,0.06)", line: "var(--up)" },
    // -10% to -20%    -> "Caution"
    { limit: -0.20, label: "Caution (≤20%)", fill: "rgba(255,176,0,0.07)", line: "var(--accent)" },
    // -20% to -35%    -> "Bad"
    { limit: -0.35, label: "Bad (≤35%)", fill: "rgba(255,91,91,0.08)", line: "var(--down)" },
    // below -35%      -> "Severe"
    { limit: -1.00, label: "Severe (>35%)", fill: "rgba(255,61,61,0.12)", line: "var(--down)" },
  ],
  height = 320,
}: {
  equity: EquityPt[];
  bands?: Band[];
  height?: number;
}) {
  const series = useMemo(() => {
    let peak = equity?.[0]?.equity ?? 0;
    return (equity || []).map((p) => {
      peak = Math.max(peak, p.equity || 0);
      const dd = peak > 0 ? p.equity / peak - 1 : 0; // 0 to -1
      return { date: p.date, dd };
    });
  }, [equity]);

  const maxDD = useMemo(() => {
    return Math.min(0, ...series.map((d) => d.dd)); // most negative
  }, [series]);

  if (!series?.length) {
    return (
      <div className="card p-6">
        <div className="text-sm text-[var(--muted)]">No drawdown data.</div>
      </div>
    );
  }

  const firstDate = series[0].date;
  const lastDate = series[series.length - 1].date;

  // Ensure bands are ordered from shallow to deep
  const ordered = [...bands].sort((a, b) => b.limit - a.limit);

  const pctFmt = (v: number) =>
    Number.isFinite(v) ? (v * 100).toFixed(0) + "%" : "";

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-2xl font-bold tracking-tight text-[var(--accent)]">Drawdown</h3>
        <div
          className="text-sm px-2 py-1 rounded-md border"
          style={{
            borderColor: "var(--border)",
            background: "var(--panel)",
          }}
          title="Maximum intraperiod drawdown"
        >
          Max DD: <span className="text-down font-semibold">{pctFmt(maxDD)}</span>
        </div>
      </div>

      <div className="w-full" style={{ height }}>
        <ResponsiveContainer>
          <AreaChart data={series} margin={{ left: 68, right: 16, top: 10, bottom: 38 }}>
            {/* Shaded severity bands spanning entire time axis */}
            {ordered.map((b, i) => {
              const yTop = i === 0 ? 0 : ordered[i - 1].limit;
              const yBottom = b.limit;
              return (
                <ReferenceArea
                  key={b.label + i}
                  x1={firstDate}
                  x2={lastDate}
                  y1={yTop}
                  y2={yBottom}
                  fill={b.fill}
                  strokeOpacity={0}
                />
              );
            })}

            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis
              dataKey="date"
              stroke="var(--muted)"
              tickMargin={12}
              tickFormatter={(iso) =>
                new Intl.DateTimeFormat("en-US", { year: "numeric", month: "2-digit" }).format(new Date(iso))
              }
            >
              <Label value="Date" position="bottom" offset={24} fill="var(--muted)" />
            </XAxis>
            <YAxis
              stroke="var(--muted)"
              tickMargin={10}
              tickFormatter={(v) => (Number.isFinite(v) ? (v * 100).toFixed(0) + "%" : "")}
              domain={[Math.min(-1, ordered[ordered.length - 1].limit), 0]}
            >
              <Label
                value="Drawdown (%)"
                angle={-90}
                position="insideLeft"
                offset={14}
                dx={-60}
                dy={30}
                fill="var(--muted)"
              />
            </YAxis>

            <Tooltip
              contentStyle={{
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                color: "var(--text)",
              }}
              formatter={(v: any) => [pctFmt(v as number), "Drawdown"]}
              labelFormatter={(iso) =>
                new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "2-digit" }).format(
                  new Date(iso as string)
                )
              }
            />

            {/* Threshold lines */}
            {ordered.slice(0, -1).map((b, i) => (
              <ReferenceLine
                key={"line-" + i}
                y={b.limit}
                stroke={b.line || "var(--border)"}
                strokeDasharray="6 6"
                strokeOpacity={0.9}
              />
            ))}

            {/* Actual DD area */}
            <defs>
              <linearGradient id="ddFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--down)" stopOpacity={0.35} />
                <stop offset="95%" stopColor="var(--down)" stopOpacity={0.08} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="dd"
              stroke="var(--down)"
              fill="url(#ddFill)"
              strokeWidth={2}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Legend for bands */}
      <div className="mt-3 flex flex-wrap gap-2 text-[12px] text-[var(--muted)]">
        {ordered.map((b, i) => {
          const yTop = i === 0 ? 0 : ordered[i - 1].limit;
          const label =
            i === 0
              ? `${b.label}`
              : `${b.label.replace("≤", "").replace(">", "")} (${pctFmt(yTop)} to ${pctFmt(b.limit)})`;
          return (
            <span key={b.label} className="inline-flex items-center gap-2">
              <span
                className="inline-block w-3.5 h-3.5 rounded-sm border"
                style={{ background: b.fill, borderColor: "var(--border)" }}
              />
              {label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
