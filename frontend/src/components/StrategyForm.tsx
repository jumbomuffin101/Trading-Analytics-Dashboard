// src/components/StrategyForm.tsx
import { useState } from "react";
import { STRATEGIES, Strategy } from "../strategies";
import { useAsync } from "../hooks/useAsync";
import Loading from "./Loading"; import ErrorBanner from "./ErrorBanner";
import api from "../lib/api"; // your axios instance

export default function StrategyForm({ onResult }:{ onResult:(data:any)=>void }) {
  const [sel, setSel] = useState<Strategy>(STRATEGIES[0]);
  const [vals, setVals] = useState<Record<string, any>>(
    Object.fromEntries(STRATEGIES[0].fields.map(f=>[f.key, f.default ?? ""]))
  );
  const { run, loading, error, setError } = useAsync(async () => {
    const payload = vals;
    return (await api.post(sel.endpoint, payload)).data;
  });

  const update = (k:string, v:any)=> setVals(s => ({...s, [k]:v}));

  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">Strategy</label>
        <select
          className="rounded-md border px-2 py-1 text-sm"
          value={sel.id}
          onChange={e=>{
            const s = STRATEGIES.find(x=>x.id===e.target.value)!;
            setSel(s);
            setVals(Object.fromEntries(s.fields.map(f=>[f.key, f.default ?? ""])));
          }}
        >
          {STRATEGIES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      <p className="text-xs text-gray-500">{sel.desc}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sel.fields.map(f => (
          <label key={f.key} className="flex flex-col gap-1 text-sm">
            <span className="text-gray-600">{f.label}</span>
            {f.type === "select" ? (
              <select
                className="rounded-md border px-2 py-1"
                value={vals[f.key] ?? ""}
                onChange={e=>update(f.key, e.target.value)}
              >
                {f.options!.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input
                type={f.type === "number" ? "number" : "text"}
                min={f.min} max={f.max} step={f.step}
                className="rounded-md border px-2 py-1"
                value={vals[f.key] ?? ""}
                onChange={e=>update(f.key, f.type==="number" ? +e.target.value : e.target.value)}
                required={f.required}
                placeholder={f.default?.toString?.()}
              />
            )}
          </label>
        ))}
      </div>

      {loading && <Loading label="Running backtest..." />}
      {error && <ErrorBanner msg={error} onClose={()=>setError(null)} />}

      <button
        className="rounded-md bg-black px-3 py-2 text-white disabled:opacity-60"
        disabled={loading}
        onClick={async ()=>{ const data = await run(); onResult(data); }}
      >
        {loading ? "Running..." : "Run"}
      </button>
    </div>
  );
}
