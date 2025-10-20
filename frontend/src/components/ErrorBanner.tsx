// src/components/ErrorBanner.tsx
export default function ErrorBanner({ msg, onClose }:{
  msg: string; onClose?: () => void;
}) {
  return (
    <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
      <div className="flex items-start justify-between gap-4">
        <p>{msg}</p>
        {onClose && (
          <button className="text-red-700/80 hover:underline" onClick={onClose}>Dismiss</button>
        )}
      </div>
    </div>
  );
}
