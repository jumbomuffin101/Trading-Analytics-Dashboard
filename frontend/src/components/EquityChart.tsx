// src/components/EquityChart.tsx
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Brush, ReferenceDot
} from "recharts";

function Tip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border bg-white/90 p-2 text-xs shadow">
      <div className="font-medium">{label}</div>
      <div>Equity: {p.equity?.toFixed(2)}</div>
      {p.trade && <div className="text-emerald-600">Trade: {p.trade}</div>}
    </div>
  );
}

export default function EquityChart({ data, showTrades=true }:{ data:any[]; showTrades?:boolean }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 12, right: 20, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" minTickGap={36} />
          <YAxis />
          <Tooltip content={<Tip />} />
          <Line type="monotone" dataKey="equity" dot={false} />
          {showTrades && data.map((d, i) => d.trade
            ? <ReferenceDot key={i} x={d.date} y={d.equity} r={3} />
            : null
          )}
          <Brush dataKey="date" height={22} travellerWidth={8} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
