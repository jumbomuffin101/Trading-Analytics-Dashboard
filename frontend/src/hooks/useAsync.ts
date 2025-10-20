// src/hooks/useAsync.ts
import { useCallback, useState } from "react";

export function useAsync<T extends any[], R>(fn: (...args: T) => Promise<R>) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (...args: T) => {
    setLoading(true); setError(null);
    try { return await fn(...args); }
    catch (e: any) { setError(e?.message ?? "Request failed"); throw e; }
    finally { setLoading(false); }
  }, [fn]);
  return { run, loading, error, setError };
}
