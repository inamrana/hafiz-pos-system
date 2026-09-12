'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2, Truck, UserPlus } from 'lucide-react';
import { formatCurrency, parseServerDate } from '@/lib/utils';

interface Item { id: number; name: string; category: string; cost_price: number; sale_price: number; unit: string; }
interface Supplier { id: number; name: string; phone: string; balance: number; }
interface PurchaseLine { id: string; itemId: number | null; name: string; quantity: number; costPrice: number; expiryDate: string; isNew: boolean; }
interface PurchaseRecord {
  id: number; purchase_number: string; supplier_name: string; payment_type: string; total: number; created_at: string;
}

const newLine = (): PurchaseLine => ({ id: `${Date.now()}-${Math.random()}`, itemId: null, name: '', quantity: 1, costPrice: 0, expiryDate: '', isNew: false });

export default function PurchasesPage() {
  const [lines, setLines] = useState<PurchaseLine[]>([newLine()]);
  const [itemQuery, setItemQuery] = useState<Record<string, Item[]>>({});
  const [supplierSearch, setSupplierSearch] = useState('');
  const [supplierSuggestions, setSupplierSuggestions] = useState<Supplier[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [paymentType, setPaymentType] = useState<'CASH' | 'CREDIT'>('CASH');
  const [processing, setProcessing] = useState(false);
  const [recent, setRecent] = useState<PurchaseRecord[]>([]);
  const [message, setMessage] = useState('');

  const loadRecent = async () => {
    const res = await fetch('/api/purchases?limit=15');
    setRecent(await res.json());
  };
  useEffect(() => { loadRecent(); }, []);

  useEffect(() => {
    if (!supplierSearch.trim()) { setSupplierSuggestions([]); return; }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/suppliers?q=${encodeURIComponent(supplierSearch)}`);
      setSupplierSuggestions(await res.json());
    }, 200);
    return () => clearTimeout(t);
  }, [supplierSearch]);

  const searchItem = async (lineId: string, q: string) => {
    setLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, name: q, itemId: null, isNew: false } : l)));
    if (!q.trim()) { setItemQuery((p) => ({ ...p, [lineId]: [] })); return; }
    const res = await fetch(`/api/items?q=${encodeURIComponent(q)}`);
    const data = res.ok ? await res.json() : [];
    setItemQuery((p) => ({ ...p, [lineId]: data }));
  };

  const pickItem = (lineId: string, item: Item) => {
    setLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, itemId: item.id, name: item.name, costPrice: item.cost_price, isNew: false } : l)));
    setItemQuery((p) => ({ ...p, [lineId]: [] }));
  };

  const updateLine = (lineId: string, patch: Partial<PurchaseLine>) => {
    setLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, ...patch } : l)));
  };

  const addLine = () => setLines((prev) => [...prev, newLine()]);
  const removeLine = (lineId: string) => setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== lineId) : prev));

  const createSupplier = async () => {
    const name = supplierSearch.trim();
    if (!name) return;
    const res = await fetch('/api/suppliers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    const s = await res.json();
    setSelectedSupplier(s);
    setSupplierSearch(s.name);
    setSupplierSuggestions([]);
  };

  const subtotal = lines.reduce((s, l) => s + l.quantity * l.costPrice, 0);

  const submit = async () => {
    const validLines = lines.filter((l) => l.name.trim() && l.quantity > 0);
    if (validLines.length === 0) { setMessage('Add at least one item with a quantity.'); return; }
    setProcessing(true);
    setMessage('');
    try {
      const res = await fetch('/api/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierId: selectedSupplier?.id || null,
          supplierName: selectedSupplier?.name || 'Unknown Supplier',
          paymentType,
          items: validLines.map((l) => ({
            itemId: l.itemId,
            name: l.name.trim(),
            quantity: Number(l.quantity),
            costPrice: Number(l.costPrice),
            expiryDate: l.expiryDate || null,
          })),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMessage(data.error || 'Failed to record purchase');
        return;
      }
      const purchase = await res.json();
      setMessage(`Purchase ${purchase.purchase_number} recorded — stock updated.`);
      setLines([newLine()]);
      setSelectedSupplier(null);
      setSupplierSearch('');
      loadRecent();
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Purchases / Stock-In</h1>
        <p className="text-slate-500 text-sm mt-0.5">Receive stock from suppliers — updates inventory and expiry batches automatically</p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-5">
        {/* Supplier + payment */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="relative">
            <label className="block text-xs font-semibold text-slate-500 mb-1">Supplier</label>
            {selectedSupplier ? (
              <div className="flex items-center justify-between border border-slate-200 rounded-xl px-4 py-2.5 bg-slate-50">
                <span className="font-medium text-sm">{selectedSupplier.name}</span>
                <button onClick={() => { setSelectedSupplier(null); setSupplierSearch(''); }} className="text-slate-400 hover:text-slate-600 text-sm">✕</button>
              </div>
            ) : (
              <>
                <input
                  value={supplierSearch}
                  onChange={(e) => setSupplierSearch(e.target.value)}
                  placeholder="Search or type new supplier..."
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {supplierSuggestions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-48 overflow-y-auto">
                    {supplierSuggestions.map((s) => (
                      <button key={s.id} onMouseDown={() => { setSelectedSupplier(s); setSupplierSearch(s.name); }} className="w-full text-left px-4 py-2.5 hover:bg-blue-50 border-b border-slate-100 last:border-0">
                        <p className="font-semibold text-sm">{s.name}</p>
                        <p className="text-xs text-slate-400">{s.phone}</p>
                      </button>
                    ))}
                  </div>
                )}
                {supplierSearch && supplierSuggestions.length === 0 && (
                  <button onMouseDown={createSupplier} className="mt-2 flex items-center gap-2 text-sm text-green-600 hover:text-green-700">
                    <UserPlus size={14} /> Create &quot;{supplierSearch}&quot; as new supplier
                  </button>
                )}
              </>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Payment Type</label>
            <div className="flex gap-2">
              <button onClick={() => setPaymentType('CASH')} className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${paymentType === 'CASH' ? 'bg-green-500 text-white' : 'bg-slate-100 text-slate-500'}`}>Cash</button>
              <button onClick={() => setPaymentType('CREDIT')} className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${paymentType === 'CREDIT' ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-500'}`}>Credit (Payable)</button>
            </div>
          </div>
        </div>

        {/* Line items */}
        <div className="space-y-3">
          <div className="grid grid-cols-12 gap-2 text-xs font-bold text-slate-500 uppercase px-1">
            <div className="col-span-5">Item</div>
            <div className="col-span-2">Qty</div>
            <div className="col-span-2">Cost Price</div>
            <div className="col-span-2">Expiry (optional)</div>
            <div className="col-span-1"></div>
          </div>
          {lines.map((line) => (
            <div key={line.id} className="grid grid-cols-12 gap-2 items-center">
              <div className="col-span-5 relative">
                <input
                  value={line.name}
                  onChange={(e) => searchItem(line.id, e.target.value)}
                  placeholder="Search or type new item name..."
                  className="w-full h-11 px-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {(itemQuery[line.id]?.length || 0) > 0 && (
                  <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-48 overflow-y-auto">
                    {itemQuery[line.id].map((it) => (
                      <button key={it.id} onMouseDown={() => pickItem(line.id, it)} className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm border-b border-slate-100 last:border-0">
                        {it.name} <span className="text-xs text-slate-400">({it.category})</span>
                      </button>
                    ))}
                  </div>
                )}
                {line.name && !line.itemId && (itemQuery[line.id]?.length || 0) === 0 && (
                  <p className="text-xs text-green-600 mt-1">New item — will be added to inventory</p>
                )}
              </div>
              <div className="col-span-2">
                <input type="number" min="0" step="0.01" value={line.quantity} onChange={(e) => updateLine(line.id, { quantity: Number(e.target.value) })} className="w-full h-11 px-3 border border-slate-200 rounded-xl text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="col-span-2">
                <input type="number" min="0" value={line.costPrice} onChange={(e) => updateLine(line.id, { costPrice: Number(e.target.value) })} className="w-full h-11 px-3 border border-slate-200 rounded-xl text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="col-span-2">
                <input type="date" value={line.expiryDate} onChange={(e) => updateLine(line.id, { expiryDate: e.target.value })} className="w-full h-11 px-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="col-span-1 flex justify-center">
                <button onClick={() => removeLine(line.id)} className="text-slate-300 hover:text-red-500"><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
          <button onClick={addLine} className="flex items-center gap-2 text-sm font-semibold text-blue-600 hover:text-blue-700">
            <Plus size={16} /> Add Line
          </button>
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 pt-4">
          <div>
            {message && <p className="text-sm font-medium text-slate-600">{message}</p>}
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-xs text-slate-400">Total</p>
              <p className="text-xl font-black text-slate-800">{formatCurrency(subtotal)}</p>
            </div>
            <button onClick={submit} disabled={processing} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white px-6 py-3 rounded-xl font-bold transition-colors">
              <Truck size={18} /> {processing ? 'Saving...' : 'Record Purchase'}
            </button>
          </div>
        </div>
      </div>

      {/* Recent purchases */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="font-bold text-slate-700">Recent Purchases</h2>
        </div>
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs font-bold text-slate-500 uppercase">
              <th className="px-5 py-3">PO #</th>
              <th className="px-5 py-3">Supplier</th>
              <th className="px-5 py-3">Date</th>
              <th className="px-5 py-3">Payment</th>
              <th className="px-5 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {recent.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-8 text-slate-400 text-sm">No purchases recorded yet.</td></tr>
            ) : (
              recent.map((p) => (
                <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50 text-sm">
                  <td className="px-5 py-3 font-semibold text-blue-600">{p.purchase_number}</td>
                  <td className="px-5 py-3">{p.supplier_name}</td>
                  <td className="px-5 py-3 text-slate-500">{parseServerDate(p.created_at).toLocaleDateString()}</td>
                  <td className="px-5 py-3">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${p.payment_type === 'CASH' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>{p.payment_type}</span>
                  </td>
                  <td className="px-5 py-3 text-right font-bold">{formatCurrency(p.total)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
