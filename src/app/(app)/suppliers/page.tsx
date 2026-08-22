'use client';

import { useEffect, useState } from 'react';
import { Search, Plus, X, ChevronDown, ChevronUp } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

interface LedgerEntry { id: number; amount: number; type: 'PURCHASE' | 'PAYMENT'; date: string; notes: string; }
interface Supplier { id: number; name: string; phone: string; address: string; balance: number; }

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [payModal, setPayModal] = useState<Supplier | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [processing, setProcessing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newSupplier, setNewSupplier] = useState({ name: '', phone: '', address: '' });

  const load = async (q = '') => {
    const res = await fetch(`/api/suppliers?q=${encodeURIComponent(q)}`);
    setSuppliers(await res.json());
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { const t = setTimeout(() => load(search), 250); return () => clearTimeout(t); }, [search]);

  const toggleExpand = async (s: Supplier) => {
    if (expanded === s.id) { setExpanded(null); return; }
    setExpanded(s.id);
    const res = await fetch(`/api/suppliers?id=${s.id}`);
    const data = await res.json();
    setLedger(data.ledger || []);
  };

  const logPayment = async () => {
    if (!payModal || !payAmount) return;
    setProcessing(true);
    await fetch('/api/suppliers', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ supplierId: payModal.id, amount: Number(payAmount), notes: payNotes }),
    });
    setProcessing(false); setPayModal(null); setPayAmount(''); setPayNotes('');
    load(search);
  };

  const createSupplier = async () => {
    if (!newSupplier.name) return;
    await fetch('/api/suppliers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSupplier),
    });
    setShowAdd(false);
    setNewSupplier({ name: '', phone: '', address: '' });
    load(search);
  };

  const totalPayable = suppliers.reduce((s, c) => s + c.balance, 0);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Suppliers</h1>
          <p className="text-slate-500 text-sm mt-0.5">{suppliers.length} suppliers</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-rose-100 text-rose-700 px-5 py-2.5 rounded-xl font-bold text-lg">
            Total Payable: {formatCurrency(totalPayable)}
          </div>
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl font-semibold transition-colors">
            <Plus size={18} /> Add Supplier
          </button>
        </div>
      </div>

      <div className="relative mb-4">
        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search supplier..." className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      <div className="space-y-3">
        {suppliers.length === 0 && <div className="text-center py-16 text-slate-400">No suppliers found.</div>}
        {suppliers.map((s) => (
          <div key={s.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="flex items-center px-5 py-4 gap-4">
              <div className="w-10 h-10 bg-rose-100 rounded-full flex items-center justify-center text-rose-600 font-bold text-lg">
                {s.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1">
                <p className="font-semibold text-slate-800">{s.name}</p>
                <p className="text-sm text-slate-400">{s.phone || 'No phone'}</p>
              </div>
              <div className="text-right">
                <p className={`text-lg font-bold ${s.balance > 0 ? 'text-red-600' : 'text-green-600'}`}>{formatCurrency(s.balance)}</p>
                <p className="text-xs text-slate-400">{s.balance > 0 ? 'Payable' : 'Settled'}</p>
              </div>
              <div className="flex gap-2 ml-2">
                {s.balance > 0 && (
                  <button onClick={() => setPayModal(s)} className="bg-green-600 hover:bg-green-700 text-white text-sm px-3 py-1.5 rounded-lg font-semibold transition-colors">
                    + Pay
                  </button>
                )}
                <button onClick={() => toggleExpand(s)} className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100">
                  {expanded === s.id ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>
              </div>
            </div>

            {expanded === s.id && (
              <div className="border-t border-slate-100 px-5 py-3">
                <p className="text-xs font-bold text-slate-500 uppercase mb-2">Transaction History</p>
                {ledger.length === 0 ? (
                  <p className="text-sm text-slate-400">No transactions yet.</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {ledger.map((e) => (
                      <div key={e.id} className="flex justify-between text-sm">
                        <div>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded mr-2 ${e.type === 'PURCHASE' ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>{e.type}</span>
                          <span className="text-slate-500">{e.notes || '—'}</span>
                        </div>
                        <div className="text-right">
                          <span className={`font-bold ${e.type === 'PURCHASE' ? 'text-red-600' : 'text-green-600'}`}>{e.type === 'PURCHASE' ? '+' : '-'}{formatCurrency(e.amount)}</span>
                          <p className="text-xs text-slate-400">{new Date(e.date).toLocaleDateString()}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {payModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h2 className="text-lg font-bold">Log Payment</h2>
              <button onClick={() => setPayModal(null)}><X size={20} className="text-slate-400" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-rose-50 rounded-xl p-4">
                <p className="font-semibold text-slate-800">{payModal.name}</p>
                <p className="text-rose-600 font-bold">Payable: {formatCurrency(payModal.balance)}</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Payment Amount (Rs)</label>
                <input autoFocus type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className="w-full border border-slate-200 rounded-xl px-4 py-3 text-xl font-bold focus:outline-none focus:ring-2 focus:ring-green-500" placeholder="0" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Notes (Optional)</label>
                <input value={payNotes} onChange={(e) => setPayNotes(e.target.value)} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-green-500" placeholder="e.g. Cash payment" />
              </div>
            </div>
            <div className="flex gap-3 p-6 pt-0">
              <button onClick={() => setPayModal(null)} className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl font-semibold hover:bg-slate-50">Cancel</button>
              <button onClick={logPayment} disabled={processing || !payAmount} className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-slate-300 text-white py-2.5 rounded-xl font-semibold">
                {processing ? 'Saving...' : 'Confirm Payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h2 className="text-lg font-bold">Add Supplier</h2>
              <button onClick={() => setShowAdd(false)}><X size={20} className="text-slate-400" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Name *</label>
                <input autoFocus value={newSupplier.name} onChange={(e) => setNewSupplier({ ...newSupplier, name: e.target.value })} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Phone</label>
                <input value={newSupplier.phone} onChange={(e) => setNewSupplier({ ...newSupplier, phone: e.target.value })} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Address</label>
                <input value={newSupplier.address} onChange={(e) => setNewSupplier({ ...newSupplier, address: e.target.value })} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div className="flex gap-3 p-6 pt-0">
              <button onClick={() => setShowAdd(false)} className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl font-semibold hover:bg-slate-50">Cancel</button>
              <button onClick={createSupplier} disabled={!newSupplier.name} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white py-2.5 rounded-xl font-semibold">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
