// frontend/src/utils/csv.ts
export type TradeCsv = {
  entry_date: string;
  entry_price: number;
  exit_date: string;
  exit_price: number;
  pnl: number;
  return_pct: number; // decimal, e.g. 0.034
  bars?: number;      // optional (we add it if we computed it)
};

export function exportTradesCSV(
  trades: TradeCsv[],
  filename = "trades.csv"
) {
  if (!trades?.length) return;

  const headers = [
    "entry_date",
    "entry_price",
    "exit_date",
    "exit_price",
    "pnl",
    "return_pct",
    "bars"
  ];

  const rows = trades.map(t => ([
    t.entry_date,
    t.entry_price,
    t.exit_date,
    t.exit_price,
    t.pnl,
    (t.return_pct ?? 0),
    (t as any).daysBars ?? ""
  ]));

  const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
