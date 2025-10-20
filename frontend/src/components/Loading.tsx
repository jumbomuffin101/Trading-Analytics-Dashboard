// src/components/Loading.tsx
export default function Loading({ label="Loading..." }:{label?:string}) {
  return (
    <div className="flex items-center gap-2 text-sm text-gray-500">
      <div className="h-4 w-4 animate-spin rounded-full border border-gray-300 border-t-transparent" />
      <span>{label}</span>
    </div>
  );
}
