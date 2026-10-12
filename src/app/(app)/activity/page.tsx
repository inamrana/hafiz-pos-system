'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Printer, Search } from 'lucide-react';
import { formatCurrency, parseServerDate, localDateInput } from '@/lib/utils';
import { ActionBadge, actionLabel, formatQty } from '@/components/ActivityBadge';

interface Entry {
  id: string; action: string; item_id: number | null; item_name: string | null; qty_change: number | null;
  qty_before: number | null; qty_after: number | null; amount: number | null; reference: string; reason: string;
  details: string; created_at: string;
}

const GROUPS = [
  { id: 'manual', label: 'My changes (no sales)' },
  { id: 'stock', label: 'Stock in / corrections' },
  { id: 'adjustments', label: 'Corrections only' },
  { id: 'purchases', label: 'Purchases' },
  { id: 'items', label: 'Item edits / deletes' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'sales', label: 'Sales & returns' },
  { id: 'all', label: 'Everything' },
];

export default function ActivityPage() {
  const today = localDateInput();
  const weekAgo = localDateInput(new Date(Date.now() - 6 * 86400000));
  const [from, setFrom] = useState(weekAgo);
  const [to, setTo] = useState(today);
  const [group, setGroup] = useState('manual');
  const [q, setQ] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      const params = new URLSearchParams({ from, to, group, q });
      const res = await fetch(`/api/activity?${params}`);
      setEntries(res.ok ? await res.json() : []);
      setLoading(false);
    }, 200);
    return () => clearTimeout(t);
  }, [from, to, group, q]);

  const added = entries.reduce((s, e) => s + (e.qty_change && e.qty_change > 0 ? e.qty_change : 0), 0);
  const removed = entries.reduce((s, e) => s + (e.qty_change && e.qty_change < 0 ? -e.qty_change : 0), 0);
  const groupLabel = GROUPS.find((g) => g.id === group)?.label;

  return (
    <div className="p-6 space-y-5">
      <div className="print-only p-4">
        <h1 className="text-xl font-bold">Activity Report: {groupLabel}</h1>
        <p className="text-sm">{from} to {to}{q ? ` · "${q}"` : ''} · {entries.length} entries</p>
        <table className="w-full mt-3 text-xs">
          <thead><tr className="border-b border-black text-left"><th className="py-1 pr-2">Date</th><th className="pr-2">What</th><th className="pr-2">Item</th><th className="pr-2 text-right">Change</th><th className="pr-2">Stock</th><th className="pr-2">Ref</th><th>Details</th></tr></thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-slate-300">
                <td className="py-1 pr-2">{parseServerDate(e.created_at).toLocaleString()}</td>
                <td className="pr-2">{actionLabel(e.action)}</td>
                <td className="pr-2">{e.item_name || ''}</td>
                <td className="pr-2 text-right">{formatQty(e.qty_change)}</td>
                <td className="pr-2">{e.qty_before !== null && e.qty_after !== null ? `${e.qty_before} → ${e.qty_after}` : ''}</td>
                <td className="pr-2">{e.reference}</td>
                <td>{[e.reason, e.details, e.amount ? formatCurrency(e.amount) : ''].filter(Boolean).join(' — ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="no-print flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Activity Log</h1>
          <p className="text-slate-500 text-sm mt-0.5">Everything that changed: stock added or removed, edits, deletes, merges, purchases and expenses</p>
        </div>
        <button onClick={() => window.print()} className="flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2.5 rounded-xl font-semibold"><Printer size={16} /> Print</button>
      </div>

      <div className="no-print bg-white rounded-2xl border border-slate-200 p-4 flex flex-wrap gap-3 items-end">
        <div><label className="block text-xs font-semibold text-slate-500 mb-1">From</label><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2 text-sm" /></div>
        <div><label className="block text-xs font-semibold text-slate-500 mb-1">To</label><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2 text-sm" /></div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Show</label>
          <select value={group} onChange={(e) => setGroup(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2 text-sm">
            {GROUPS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        </div>
        <div className="relative flex-1 min-w-48">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item, bill/PO number, reason..." className="w-full border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-sm" />
        </div>
        <div className="flex gap-2">
          {[['Today', today, today], ['7 days', weekAgo, today], ['30 days', localDateInput(new Date(Date.now() - 29 * 86400000)), today]].map(([label, f, t]) => (
            <button key={label} onClick={() => { setFrom(f); setTo(t); }} className="px-3 py-2 rounded-xl text-xs font-bold bg-slate-100 text-slate-600 hover:bg-slate-200">{label}</button>
          ))}
        </div>
      </div>

      <div className="no-print grid grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4"><p className="text-xs text-slate-400">Entries</p><p className="text-2xl font-black">{entries.length}</p></div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4"><p className="text-xs text-slate-400">Stock added</p><p className="text-2xl font-black text-green-600">+{Math.round(added * 100) / 100}</p></div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4"><p className="text-xs text-slate-400">Stock removed</p><p className="text-2xl font-black text-red-600">−{Math.round(removed * 100) / 100}</p></div>
      </div>

      <div className="no-print bg-white rounded-2xl shadow-sm border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs font-bold text-slate-500 uppercase">
              <th className="px-5 py-3">Date & Time</th>
              <th className="px-5 py-3">What</th>
              <th className="px-5 py-3">Item</th>
              <th className="px-5 py-3 text-right">Change</th>
              <th className="px-5 py-3 text-center">Stock</th>
              <th className="px-5 py-3">Reference</th>
              <th className="px-5 py-3">Reason / Details</th>
            </tr>
          </thead>
          <tbody>
            {loading && entries.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8 text-slate-400">Loading...</td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8 text-slate-400">Nothing recorded for these filters.</td></tr>
            ) : entries.map((e) => (
              <tr key={e.id} className="border-b border-slate-100 align-top hover:bg-slate-50">
                <td className="px-5 py-3 text-slate-500 whitespace-nowrap">{parseServerDate(e.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</td>
                <td className="px-5 py-3"><ActionBadge action={e.action} /></td>
                <td className="px-5 py-3 font-semibold">
                  {e.item_id ? <Link href={`/stock/manage?id=${e.item_id}`} className="hover:text-blue-600">{e.item_name}</Link> : (e.item_name || '—')}
                </td>
                <td className={`px-5 py-3 text-right font-bold whitespace-nowrap ${(e.qty_change || 0) > 0 ? 'text-green-600' : (e.qty_change || 0) < 0 ? 'text-red-600' : 'text-slate-400'}`}>{formatQty(e.qty_change)}</td>
                <td className="px-5 py-3 text-center text-slate-600 whitespace-nowrap">{e.qty_before !== null && e.qty_after !== null ? <>{e.qty_before} → <b>{e.qty_after}</b></> : '—'}</td>
                <td className="px-5 py-3 font-mono text-xs text-blue-600 whitespace-nowrap">{e.reference || '—'}</td>
                <td className="px-5 py-3 text-slate-600">{e.reason}{e.details ? <span className="block text-xs text-slate-400">{e.details}</span> : null}{e.amount ? <span className="block text-xs text-slate-400">{formatCurrency(e.amount)}</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
