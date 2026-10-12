'use client';

import { useCallback, useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Search, PackagePlus, PackageMinus, Pencil, GitMerge, History, Printer, Info } from 'lucide-react';
import { formatCurrency, parseServerDate } from '@/lib/utils';
import { ActionBadge, formatQty } from '@/components/ActivityBadge';

interface Item {
  id: number; barcode: string | null; name: string; category: string; cost_price: number; sale_price: number;
  quantity: number; unit: string; unit_type: 'COUNT' | 'WEIGHT'; low_stock_threshold: number; archived: number;
}
interface Supplier { id: number; name: string; phone: string; }
interface Entry {
  id: string; action: string; qty_change: number | null; qty_before: number | null; qty_after: number | null;
  amount: number | null; reference: string; reason: string; details: string; created_at: string;
}
interface History { item: Item; entries: Entry[]; unrecorded: number; }

type Tab = 'in' | 'correct' | 'edit' | 'merge';

const REMOVE_REASONS = ['Damaged / broken', 'Lost / stolen', 'Expired', 'Count correction', 'Personal / shop use', 'Given free / sample', 'Returned to supplier', 'Other'];
const ADD_REASONS = ['Count correction', 'Found extra stock', 'Received free / gift', 'Customer return (no bill)', 'Other'];
const SET_REASONS = ['Stock count', 'Count correction', 'Other'];

const inputCls = 'w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm';
const labelCls = 'block text-xs font-semibold text-slate-500 mb-1';

/** Type-ahead item search shared by the item picker and the merge picker. */
function ItemSearch({ onPick, placeholder, excludeId }: { onPick: (i: Item) => void; placeholder: string; excludeId?: number }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Item[]>([]);
  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/items?q=${encodeURIComponent(q)}`);
      const data: Item[] = res.ok ? await res.json() : [];
      setResults(data.filter((i) => i.id !== excludeId).slice(0, 20));
    }, 200);
    return () => clearTimeout(t);
  }, [q, excludeId]);
  return (
    <div className="relative">
      <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className={`${inputCls} pl-10`} />
      {results.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-72 overflow-y-auto">
          {results.map((i) => (
            <button key={i.id} onMouseDown={() => { onPick(i); setQ(''); setResults([]); }} className="w-full text-left px-4 py-2.5 hover:bg-blue-50 border-b border-slate-100 last:border-0 text-sm flex justify-between gap-3">
              <span><span className="font-mono text-xs text-slate-400 mr-2">#{i.id}</span><b>{i.name}</b> <span className="text-xs text-slate-400">{i.category}</span></span>
              <span className="text-slate-500 shrink-0">Stock {i.quantity}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ManageStockClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const itemId = Number(searchParams.get('id')) || null;

  const [data, setData] = useState<History | null>(null);
  const [tab, setTab] = useState<Tab>('in');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Stock in
  const [inQty, setInQty] = useState('');
  const [inCost, setInCost] = useState('');
  const [inExpiry, setInExpiry] = useState('');
  const [inPay, setInPay] = useState<'CASH' | 'CREDIT'>('CASH');
  const [inNotes, setInNotes] = useState('');
  const [supplierSearch, setSupplierSearch] = useState('');
  const [supplierSuggestions, setSupplierSuggestions] = useState<Supplier[]>([]);
  const [supplier, setSupplier] = useState<Supplier | null>(null);

  // Correction
  const [mode, setMode] = useState<'REMOVE' | 'SET' | 'ADD'>('REMOVE');
  const [corrQty, setCorrQty] = useState('');
  const [reason, setReason] = useState(REMOVE_REASONS[0]);
  const [corrNotes, setCorrNotes] = useState('');

  // Edit
  const [form, setForm] = useState({ name: '', barcode: '', category: '', costPrice: '', salePrice: '', unit: '', unitType: 'COUNT' as 'COUNT' | 'WEIGHT', lowStockThreshold: '' });

  // Merge
  const [mergeSource, setMergeSource] = useState<Item | null>(null);

  const load = useCallback(async () => {
    if (!itemId) { setData(null); return; }
    const res = await fetch(`/api/items?id=${itemId}&history=1`);
    const h: History | null = res.ok ? await res.json() : null;
    setData(h);
    if (h) {
      const i = h.item;
      setForm({
        name: i.name, barcode: i.barcode || '', category: i.category, costPrice: String(i.cost_price), salePrice: String(i.sale_price),
        unit: i.unit, unitType: i.unit_type, lowStockThreshold: String(i.low_stock_threshold),
      });
      setInCost((prev) => prev || String(i.cost_price));
    }
  }, [itemId]);

  useEffect(() => { setMessage(null); setInCost(''); setMergeSource(null); load(); }, [load]);

  useEffect(() => {
    setReason(mode === 'REMOVE' ? REMOVE_REASONS[0] : mode === 'ADD' ? ADD_REASONS[0] : SET_REASONS[0]);
  }, [mode]);

  useEffect(() => {
    if (!supplierSearch.trim() || supplier) { setSupplierSuggestions([]); return; }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/suppliers?q=${encodeURIComponent(supplierSearch)}`);
      setSupplierSuggestions(res.ok ? await res.json() : []);
    }, 200);
    return () => clearTimeout(t);
  }, [supplierSearch, supplier]);

  const item = data?.item;
  const done = async (ok: boolean, text: string) => {
    setMessage({ ok, text });
    if (ok) await load();
  };

  const submitStockIn = async () => {
    if (!item) return;
    const qty = Number(inQty);
    const cost = Number(inCost);
    if (!(qty > 0)) return done(false, 'Enter how many you bought.');
    if (inPay === 'CREDIT' && !supplier && !supplierSearch.trim()) return done(false, 'Credit purchases need a supplier, so the amount owed is tracked.');
    setBusy(true);
    try {
      let s = supplier;
      if (!s && supplierSearch.trim()) {
        const res = await fetch('/api/suppliers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: supplierSearch.trim() }) });
        s = res.ok ? await res.json() : null;
      }
      const res = await fetch('/api/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierId: s?.id || null,
          supplierName: s?.name || 'Unknown Supplier',
          paymentType: inPay,
          notes: inNotes.trim(),
          items: [{ itemId: item.id, name: item.name, quantity: qty, costPrice: cost || 0, expiryDate: inExpiry || null }],
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return done(false, body.error || 'Failed to add stock');
      setInQty(''); setInExpiry(''); setInNotes(''); setSupplier(null); setSupplierSearch('');
      await done(true, `Added ${qty} ${item.unit}. Recorded as purchase ${body.purchase_number}, and ${formatCurrency(qty * (cost || 0))} added to Expenses${inPay === 'CREDIT' ? ' (owed to supplier)' : ''}.`);
    } finally {
      setBusy(false);
    }
  };

  const submitCorrection = async () => {
    if (!item) return;
    if (corrQty === '' || Number(corrQty) < 0) return done(false, 'Enter a quantity.');
    setBusy(true);
    try {
      const res = await fetch('/api/items/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, mode, quantity: Number(corrQty), reason, notes: corrNotes.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return done(false, body.error || 'Failed to update stock');
      setCorrQty(''); setCorrNotes('');
      await done(true, `Stock changed ${item.quantity} → ${body.quantity}. Saved in history (${reason}).`);
    } finally {
      setBusy(false);
    }
  };

  const submitEdit = async () => {
    if (!item) return;
    setBusy(true);
    try {
      const res = await fetch('/api/items', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: item.id, name: form.name, barcode: form.barcode || null, category: form.category,
          cost_price: Number(form.costPrice) || 0, sale_price: Number(form.salePrice) || 0, unit: form.unit,
          unit_type: form.unitType, low_stock_threshold: Number(form.lowStockThreshold) || 0,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return done(false, body.error || 'Failed to save');
      await done(true, 'Details saved. The changes are listed in history.');
    } finally {
      setBusy(false);
    }
  };

  const submitMerge = async () => {
    if (!item || !mergeSource) return;
    if (!confirm(`Merge "${mergeSource.name}" (ID ${mergeSource.id}, stock ${mergeSource.quantity}) into "${item.name}"?\n\n"${mergeSource.name}" will be removed. Its sales history moves here and its stock is added (${item.quantity} + ${mergeSource.quantity} = ${item.quantity + mergeSource.quantity}).`)) return;
    setBusy(true);
    try {
      const res = await fetch('/api/items/merge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: mergeSource.id, targetId: item.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return done(false, body.error || 'Merge failed');
      setMergeSource(null);
      await done(true, `Merged "${mergeSource.name}" into this item.`);
    } finally {
      setBusy(false);
    }
  };

  const corrPreview = item && corrQty !== ''
    ? mode === 'ADD' ? item.quantity + Number(corrQty) : mode === 'REMOVE' ? item.quantity - Number(corrQty) : Number(corrQty)
    : null;

  const tabs: { id: Tab; label: string; icon: typeof PackagePlus }[] = [
    { id: 'in', label: 'Stock In (bought)', icon: PackagePlus },
    { id: 'correct', label: 'Remove / Correct', icon: PackageMinus },
    { id: 'edit', label: 'Edit Details', icon: Pencil },
    { id: 'merge', label: 'Merge Duplicate', icon: GitMerge },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Print-only history */}
      {item && data && (
        <div className="print-only p-4">
          <h1 className="text-xl font-bold">Stock History: {item.name}</h1>
          <p className="text-sm">Current stock: {item.quantity} {item.unit} · printed {new Date().toLocaleString()}</p>
          <table className="w-full mt-3 text-xs">
            <thead><tr className="border-b border-black text-left"><th className="py-1 pr-2">Date</th><th className="pr-2">What</th><th className="pr-2 text-right">Change</th><th className="pr-2">Stock</th><th className="pr-2">Ref</th><th>Reason / details</th></tr></thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.id} className="border-b border-slate-300">
                  <td className="py-1 pr-2">{parseServerDate(e.created_at).toLocaleString()}</td>
                  <td className="pr-2">{e.action}</td>
                  <td className="pr-2 text-right">{formatQty(e.qty_change)}</td>
                  <td className="pr-2">{e.qty_before !== null && e.qty_after !== null ? `${e.qty_before} → ${e.qty_after}` : ''}</td>
                  <td className="pr-2">{e.reference}</td>
                  <td>{[e.reason, e.details].filter(Boolean).join(' — ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="no-print flex items-center justify-between gap-4 flex-wrap">
        <div>
          <Link href="/stock" className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1"><ArrowLeft size={14} /> Stock</Link>
          <h1 className="text-2xl font-bold text-slate-800 mt-1">Manage Stock</h1>
          <p className="text-slate-500 text-sm mt-0.5">Add bought stock, fix counts, edit details. Every change is saved in history.</p>
        </div>
        <div className="w-full sm:w-96">
          <ItemSearch placeholder="Find an item by name, barcode or ID..." onPick={(i) => router.push(`/stock/manage?id=${i.id}`)} />
        </div>
      </div>

      {!itemId && (
        <div className="no-print bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-500">
          Search for an item above to add stock, correct its quantity, or see exactly how its stock changed.
        </div>
      )}
      {itemId && !data && <div className="no-print text-slate-400">Loading...</div>}

      {item && data && (
        <div className="no-print space-y-6">
          {/* Summary */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-wrap gap-6 items-center justify-between">
            <div>
              <p className="text-xs font-mono text-slate-400">#{item.id}{item.barcode ? ` · ${item.barcode}` : ''}</p>
              <h2 className="text-xl font-bold text-slate-800">{item.name}</h2>
              <span className="bg-blue-50 text-blue-700 text-xs font-semibold px-2.5 py-1 rounded-full">{item.category}</span>
              {item.archived ? <span className="ml-2 bg-slate-100 text-slate-500 text-xs font-semibold px-2.5 py-1 rounded-full">Removed from stock</span> : null}
            </div>
            <div className="flex gap-8 text-right">
              <div><p className="text-xs text-slate-400">In stock</p><p className={`text-3xl font-black ${item.quantity <= item.low_stock_threshold ? 'text-red-600' : 'text-slate-800'}`}>{item.quantity}<span className="text-sm font-semibold text-slate-400 ml-1">{item.unit}</span></p></div>
              <div><p className="text-xs text-slate-400">Cost</p><p className="text-lg font-bold">{formatCurrency(item.cost_price)}</p></div>
              <div><p className="text-xs text-slate-400">Sale</p><p className="text-lg font-bold">{formatCurrency(item.sale_price)}</p></div>
              <div><p className="text-xs text-slate-400">Stock value</p><p className="text-lg font-bold">{formatCurrency(item.quantity * item.cost_price)}</p></div>
            </div>
          </div>

          {/* Actions */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="flex border-b border-slate-200 overflow-x-auto">
              {tabs.map(({ id, label, icon: Icon }) => (
                <button key={id} onClick={() => { setTab(id); setMessage(null); }} className={`flex items-center gap-2 px-5 py-3.5 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${tab === id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
                  <Icon size={16} /> {label}
                </button>
              ))}
            </div>
            <div className="p-6 space-y-4">
              {message && (
                <div className={`px-4 py-3 rounded-xl text-sm font-medium border ${message.ok ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>{message.text}</div>
              )}

              {tab === 'in' && (
                <>
                  <p className="text-sm text-slate-500">Use this when you buy more of this item. It adds the stock, saves a purchase, and the cost shows in <Link href="/expenses" className="text-blue-600 font-semibold">Expenses</Link>. For many items at once, use <Link href="/purchases" className="text-blue-600 font-semibold">Purchases</Link>.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div><label className={labelCls}>Quantity bought *</label><input type="number" min="0" step={item.unit_type === 'WEIGHT' ? '0.01' : '1'} value={inQty} onChange={(e) => setInQty(e.target.value)} className={inputCls} autoFocus /></div>
                    <div><label className={labelCls}>Cost per {item.unit} (Rs)</label><input type="number" min="0" value={inCost} onChange={(e) => setInCost(e.target.value)} className={inputCls} /></div>
                    <div><label className={labelCls}>Expiry (optional)</label><input type="date" value={inExpiry} onChange={(e) => setInExpiry(e.target.value)} className={inputCls} /></div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="relative">
                      <label className={labelCls}>Supplier (optional)</label>
                      {supplier ? (
                        <div className="flex items-center justify-between border border-slate-200 rounded-xl px-4 py-2.5 bg-slate-50 text-sm">
                          <span className="font-medium">{supplier.name}</span>
                          <button onClick={() => { setSupplier(null); setSupplierSearch(''); }} className="text-slate-400 hover:text-slate-600">✕</button>
                        </div>
                      ) : (
                        <>
                          <input value={supplierSearch} onChange={(e) => setSupplierSearch(e.target.value)} placeholder="Search or type a new supplier..." className={inputCls} />
                          {supplierSuggestions.length > 0 && (
                            <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-48 overflow-y-auto">
                              {supplierSuggestions.map((s) => (
                                <button key={s.id} onMouseDown={() => { setSupplier(s); setSupplierSearch(s.name); }} className="w-full text-left px-4 py-2 hover:bg-blue-50 text-sm border-b border-slate-100 last:border-0">{s.name}</button>
                              ))}
                            </div>
                          )}
                          {supplierSearch.trim() && supplierSuggestions.length === 0 && <p className="text-xs text-green-600 mt-1">New supplier, will be created</p>}
                        </>
                      )}
                    </div>
                    <div>
                      <label className={labelCls}>Paid</label>
                      <div className="flex gap-2">
                        <button onClick={() => setInPay('CASH')} className={`flex-1 py-2.5 rounded-xl text-sm font-semibold ${inPay === 'CASH' ? 'bg-green-500 text-white' : 'bg-slate-100 text-slate-500'}`}>Cash (paid now)</button>
                        <button onClick={() => setInPay('CREDIT')} className={`flex-1 py-2.5 rounded-xl text-sm font-semibold ${inPay === 'CREDIT' ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-500'}`}>Credit (pay later)</button>
                      </div>
                    </div>
                  </div>
                  <div><label className={labelCls}>Note (optional)</label><input value={inNotes} onChange={(e) => setInNotes(e.target.value)} placeholder="e.g. bill no. 4512, bought from market" className={inputCls} /></div>
                  <div className="flex items-center justify-between border-t border-slate-100 pt-4">
                    <p className="text-sm text-slate-600">
                      {Number(inQty) > 0 && <>Stock {item.quantity} → <b>{item.quantity + Number(inQty)}</b> · Expense <b>{formatCurrency(Number(inQty) * (Number(inCost) || 0))}</b></>}
                    </p>
                    <button onClick={submitStockIn} disabled={busy} className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white px-6 py-2.5 rounded-xl font-bold">{busy ? 'Saving...' : 'Add Stock'}</button>
                  </div>
                </>
              )}

              {tab === 'correct' && (
                <>
                  <p className="text-sm text-slate-500">Use this when the shelf count doesn&apos;t match, or stock is damaged, lost, used or given away. Bought stock goes in <b>Stock In</b> so the cost is recorded.</p>
                  <div className="flex gap-2 flex-wrap">
                    {([['REMOVE', 'Remove some'], ['SET', 'Set to counted quantity'], ['ADD', 'Add (not bought)']] as const).map(([m, label]) => (
                      <button key={m} onClick={() => setMode(m)} className={`px-4 py-2 rounded-xl text-sm font-semibold ${mode === m ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}>{label}</button>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>{mode === 'SET' ? 'Quantity counted on shelf *' : mode === 'REMOVE' ? 'How many to remove *' : 'How many to add *'}</label>
                      <input type="number" min="0" step={item.unit_type === 'WEIGHT' ? '0.01' : '1'} value={corrQty} onChange={(e) => setCorrQty(e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Reason *</label>
                      <select value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls}>
                        {(mode === 'REMOVE' ? REMOVE_REASONS : mode === 'ADD' ? ADD_REASONS : SET_REASONS).map((r) => <option key={r}>{r}</option>)}
                      </select>
                    </div>
                  </div>
                  <div><label className={labelCls}>Note (optional)</label><input value={corrNotes} onChange={(e) => setCorrNotes(e.target.value)} placeholder="Anything to remember about this change" className={inputCls} /></div>
                  <div className="flex items-center justify-between border-t border-slate-100 pt-4">
                    <p className="text-sm text-slate-600">{corrPreview !== null && <>Stock {item.quantity} → <b className={corrPreview < 0 ? 'text-red-600' : ''}>{corrPreview}</b></>}</p>
                    <button onClick={submitCorrection} disabled={busy} className="bg-slate-800 hover:bg-slate-900 disabled:bg-slate-300 text-white px-6 py-2.5 rounded-xl font-bold">{busy ? 'Saving...' : 'Save Change'}</button>
                  </div>
                </>
              )}

              {tab === 'edit' && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div><label className={labelCls}>Item name *</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} /></div>
                    <div><label className={labelCls}>Barcode</label><input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} className={inputCls} /></div>
                    <div><label className={labelCls}>Category</label><input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputCls} /></div>
                    <div>
                      <label className={labelCls}>Item type</label>
                      <select value={form.unitType} onChange={(e) => setForm({ ...form, unitType: e.target.value as 'COUNT' | 'WEIGHT' })} className={inputCls}>
                        <option value="COUNT">Counted (pcs, box...)</option>
                        <option value="WEIGHT">Loose / Weighed (kg, g, ltr...)</option>
                      </select>
                    </div>
                    <div><label className={labelCls}>Cost price (Rs)</label><input type="number" value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} className={inputCls} /></div>
                    <div><label className={labelCls}>Sale price (Rs)</label><input type="number" value={form.salePrice} onChange={(e) => setForm({ ...form, salePrice: e.target.value })} className={inputCls} /></div>
                    <div><label className={labelCls}>Unit label</label><input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className={inputCls} /></div>
                    <div><label className={labelCls}>Low stock alert below</label><input type="number" value={form.lowStockThreshold} onChange={(e) => setForm({ ...form, lowStockThreshold: e.target.value })} className={inputCls} /></div>
                  </div>
                  <p className="text-xs text-slate-400">Quantity can&apos;t be edited here. Use Stock In or Remove / Correct so every change has a reason.</p>
                  <div className="flex justify-end border-t border-slate-100 pt-4">
                    <button onClick={submitEdit} disabled={busy || !form.name.trim()} className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white px-6 py-2.5 rounded-xl font-bold">{busy ? 'Saving...' : 'Save Details'}</button>
                  </div>
                </>
              )}

              {tab === 'merge' && (
                <>
                  <p className="text-sm text-slate-500">Is the same product in stock twice under another name? Pick the duplicate below. It is merged into <b>{item.name}</b>: its sales history moves here, its stock is added, and the duplicate is removed.</p>
                  {mergeSource ? (
                    <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm">
                      <span><span className="font-mono text-slate-400 mr-2">#{mergeSource.id}</span><b>{mergeSource.name}</b> · stock {mergeSource.quantity} · {formatCurrency(mergeSource.sale_price)}</span>
                      <button onClick={() => setMergeSource(null)} className="text-slate-400 hover:text-slate-600">✕</button>
                    </div>
                  ) : (
                    <ItemSearch placeholder="Search for the duplicate item..." excludeId={item.id} onPick={setMergeSource} />
                  )}
                  <div className="flex items-center justify-between border-t border-slate-100 pt-4">
                    <p className="text-sm text-slate-600">{mergeSource && <>Stock {item.quantity} + {mergeSource.quantity} → <b>{item.quantity + mergeSource.quantity}</b></>}</p>
                    <button onClick={submitMerge} disabled={busy || !mergeSource} className="bg-amber-500 hover:bg-amber-600 disabled:bg-slate-300 text-white px-6 py-2.5 rounded-xl font-bold">{busy ? 'Merging...' : 'Merge Into This Item'}</button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* History */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="font-bold text-slate-700 flex items-center gap-2"><History size={18} /> Stock History</h2>
              <button onClick={() => window.print()} className="flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-800"><Printer size={15} /> Print</button>
            </div>
            {Math.abs(data.unrecorded) > 0.0001 && (
              <div className="mx-6 mt-4 flex gap-2 bg-slate-50 border border-slate-200 text-slate-600 px-4 py-3 rounded-xl text-xs">
                <Info size={16} className="shrink-0 mt-0.5" />
                <span><b>{formatQty(data.unrecorded)}</b> of the current stock comes from opening stock, Excel imports or edits made before history tracking started. Those weren&apos;t recorded, so they don&apos;t show below. From now on every change is recorded.</span>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs font-bold text-slate-500 uppercase">
                    <th className="px-5 py-3">Date & Time</th>
                    <th className="px-5 py-3">What happened</th>
                    <th className="px-5 py-3 text-right">Change</th>
                    <th className="px-5 py-3 text-center">Stock</th>
                    <th className="px-5 py-3">Reference</th>
                    <th className="px-5 py-3">Reason / Details</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-8 text-slate-400">No history yet.</td></tr>
                  ) : data.entries.map((e) => (
                    <tr key={e.id} className="border-b border-slate-100 align-top">
                      <td className="px-5 py-3 text-slate-500 whitespace-nowrap">{parseServerDate(e.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</td>
                      <td className="px-5 py-3"><ActionBadge action={e.action} /></td>
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
        </div>
      )}
    </div>
  );
}

export default function ManageStockPage() {
  return (
    <Suspense fallback={<div className="p-6 text-slate-400">Loading...</div>}>
      <ManageStockClient />
    </Suspense>
  );
}

