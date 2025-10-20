// src/utils/stats.ts
export function wilsonCI(wins: number, total: number, z = 1.96) {
  if (total <= 0) return { p: 0, lo: 0, hi: 0 };
  const p = wins / total;
  const z2 = z*z;
  const denom = 1 + z2/total;
  const center = (p + z2/(2*total)) / denom;
  const half = (z * Math.sqrt((p*(1-p) + z2/(4*total)) / total)) / denom;
  return { p, lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}
