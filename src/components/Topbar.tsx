'use client';

export default function Topbar() {
  return (
    <div className="no-print flex items-center justify-end gap-3 px-6 py-2.5 bg-white border-b border-slate-200">
      <span className="text-xs text-slate-400">
        {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}
      </span>
    </div>
  );
}
