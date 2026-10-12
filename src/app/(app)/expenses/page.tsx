'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Printer, Trash2, Wallet } from 'lucide-react';
import { formatCurrency, localDateInput } from '@/lib/utils';

interface Row {
  source: 'expense' | 'purchase'; id: number; date: string; category: string; description: string;
  amount: number; payment_method: string; reference: string;
}
interface Data {
  rows: Row[];
  totals: { total: number; stockTotal: number; otherTotal: number; count: number };
  byCategory: { category: string; amount: number }[];
  categories: string[];
}

function monthStart() {
  const d = new Date();
  return localDateInput(new Date(d.getFullYear(), d.getMonth(), 1));
}

export default function ExpensesPage() {
  const today = localDateInput();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today);
  const [data, setData] = useState<Data | null>(null);
  const [form, setForm] = useState({ category: 'Rent', description: '', amount: '', paymentMethod: 'CASH', date: today });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const res = await fetch(`/api/expenses?from=${from}&to=${to}`);
    if (res.ok) setData(await res.json());
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setError('');
    if (!(Number(form.amount) > 0)) { setError('Enter an amount.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, amount: Number(form.amount) }),
      });
      if (!res.ok) { setError((await res.json().catch(() => ({}))).error || 'Failed to save'); return; }
      setForm({ ...form, description: '', amount: '' });
      load();
    } finally {
      setSaving(false);
    }
  };

  const del = async (r: Row) => {
    if (!confirm(`Delete expense "${r.description || r.category}" (${formatCurrency(r.amount)})?`)) return;
    await fetch(`/api/expenses?id=${r.id}`, { method: 'DELETE' });
    load();
  };

  // Stock purchases come from Purchases, so they don't need picking here again.
  const categories = (data?.categories || []).filter((c) => c !== 'Stock Purchase');

  return (
    <div className="p-6 space-y-5">
      <div className="print-only p-4">
        <h1 className="text-xl font-bold">Expenses {from} to {to}</h1>
        <p className="text-sm">Total {formatCurrency(data?.totals.total || 0)} · Stock {formatCurrency(data?.totals.stockTotal || 0)} · Other {formatCurrency(data?.totals.otherTotal || 0)}</p>
        <table className="w-full mt-3 text-xs">
          <thead><tr className="border-b border-black text-left"><th className="py-1 pr-2">Date</th><th className="pr-2">Category</th><th className="pr-2">Description</th><th className="pr-2">Ref</th><th className="pr-2">Paid</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {data?.rows.map((r) => (
              <tr key={`${r.source}-${r.id}`} className="border-b border-slate-300">
                <td className="py-1 pr-2">{r.date}</td><td className="pr-2">{r.category}</td><td className="pr-2">{r.description}</td>
                <td className="pr-2">{r.reference}</td><td className="pr-2">{r.payment_method}</td><td className="text-right">{formatCurrency(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="no-print flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Expenses</h1>
          <p className="text-slate-500 text-sm mt-0.5">All money going out. Stock bought through <Link href="/purchases" className="text-blue-600 font-semibold">Purchases</Link> or <Link href="/stock/manage" className="text-blue-600 font-semibold">Manage Stock</Link> is added here automatically.</p>
        </div>
        <button onClick={() => window.print()} className="flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2.5 rounded-xl font-semibold"><Printer size={16} /> Print</button>
      </div>

      {/* Add expense */}
      <div className="no-print bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-bold text-slate-700 mb-3 flex items-center gap-2"><Wallet size={18} /> Add an expense</h2>
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 items-end">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Category</label>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm">
              {categories.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-slate-500 mb-1">Description</label>
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. October shop rent" className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Amount (Rs) *</label>
            <input type="number" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') save(); }} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Date</label>
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm" />
          </div>
          <div className="flex gap-2">
            <select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })} className="flex-1 border border-slate-200 rounded-xl px-2 py-2.5 text-sm">
              <option value="CASH">Cash</option>
              <option value="BANK">Bank / Online</option>
            </select>
            <button onClick={save} disabled={saving} className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white px-4 py-2.5 rounded-xl font-bold text-sm"><Plus size={16} /> Add</button>
          </div>
        </div>
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
      </div>

      {/* Filters + totals */}
      <div className="no-print flex flex-wrap gap-3 items-end">
        <div><label className="block text-xs font-semibold text-slate-500 mb-1">From</label><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white" /></div>
        <div><label className="block text-xs font-semibold text-slate-500 mb-1">To</label><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white" /></div>
        <button onClick={() => { setFrom(today); setTo(today); }} className="px-3 py-2 rounded-xl text-xs font-bold bg-slate-200/70 text-slate-600 hover:bg-slate-200">Today</button>
        <button onClick={() => { setFrom(monthStart()); setTo(today); }} className="px-3 py-2 rounded-xl text-xs font-bold bg-slate-200/70 text-slate-600 hover:bg-slate-200">This month</button>
      </div>

      <div className="no-print grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4"><p className="text-xs text-slate-400">Total spent</p><p className="text-2xl font-black text-slate-800">{formatCurrency(data?.totals.total || 0)}</p></div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4"><p className="text-xs text-slate-400">Stock bought</p><p className="text-2xl font-black text-green-700">{formatCurrency(data?.totals.stockTotal || 0)}</p></div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4"><p className="text-xs text-slate-400">Other expenses</p><p className="text-2xl font-black text-rose-600">{formatCurrency(data?.totals.otherTotal || 0)}</p></div>
      </div>

      {data && data.byCategory.length > 0 && (
        <div className="no-print flex flex-wrap gap-2">
          {data.byCategory.map((c) => (
            <span key={c.category} className="bg-white border border-slate-200 rounded-full px-3 py-1 text-xs"><b>{c.category}</b> · {formatCurrency(c.amount)}</span>
          ))}
        </div>
      )}

      <div className="no-print bg-white rounded-2xl shadow-sm border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs font-bold text-slate-500 uppercase">
              <th className="px-5 py-3">Date</th>
              <th className="px-5 py-3">Category</th>
              <th className="px-5 py-3">Description</th>
              <th className="px-5 py-3">Reference</th>
              <th className="px-5 py-3">Paid</th>
              <th className="px-5 py-3 text-right">Amount</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {!data || data.rows.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8 text-slate-400">No expenses in this period.</td></tr>
            ) : data.rows.map((r) => (
              <tr key={`${r.source}-${r.id}`} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-5 py-3 text-slate-500 whitespace-nowrap">{r.date}</td>
                <td className="px-5 py-3"><span className={`text-xs font-bold px-2 py-0.5 rounded-md ${r.source === 'purchase' ? 'bg-green-100 text-green-700' : 'bg-rose-100 text-rose-700'}`}>{r.category}</span></td>
                <td className="px-5 py-3">{r.description || '—'}</td>
                <td className="px-5 py-3 font-mono text-xs text-blue-600">{r.reference}</td>
                <td className="px-5 py-3 text-xs">{r.payment_method === 'CREDIT' ? <span className="text-orange-600 font-bold">Credit (owed)</span> : r.payment_method === 'BANK' ? 'Bank' : 'Cash'}</td>
                <td className="px-5 py-3 text-right font-bold">{formatCurrency(r.amount)}</td>
                <td className="px-5 py-3 text-right">
                  {r.source === 'expense'
                    ? <button onClick={() => del(r)} className="text-slate-300 hover:text-red-600"><Trash2 size={15} /></button>
                    : <Link href="/purchases" className="text-xs text-slate-400 hover:text-blue-600">view</Link>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
