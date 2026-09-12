'use client';

import { useEffect, useState } from 'react';
import { Search, Plus, X, ChevronDown, ChevronUp } from 'lucide-react';
import { formatCurrency, parseServerDate } from '@/lib/utils';

interface LedgerEntry { amount: number; type: string; date: string; notes: string; }
interface Customer { id: number; name: string; phone: string; balance: number; ledger: LedgerEntry[]; }

export default function UdhaarPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [payModal, setPayModal] = useState<Customer | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [processing, setProcessing] = useState(false);

  const load = async (q = '') => {
    const res = await fetch(`/api/customers?q=${q}`);
    setCustomers(await res.json());
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { const t = setTimeout(() => load(search), 250); return () => clearTimeout(t); }, [search]);

  const logPayment = async () => {
    if (!payModal || !payAmount) return;
    setProcessing(true);
    await fetch('/api/customers', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId: payModal.id, amount: Number(payAmount), notes: payNotes }),
    });
    setProcessing(false); setPayModal(null); setPayAmount(''); setPayNotes('');
    load(search);
  };

  const totalOutstanding = customers.reduce((s, c) => s + c.balance, 0);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Udhaar Khaata</h1>
          <p className="text-slate-500 text-sm mt-0.5">{customers.length} customers</p>
        </div>
        <div className="bg-orange-100 text-orange-700 px-5 py-2.5 rounded-xl font-bold text-lg">
          Total Outstanding: {formatCurrency(totalOutstanding)}
        </div>
      </div>

      <div className="relative mb-4">
        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customer..." className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      <div className="space-y-3">
        {customers.length === 0 && <div className="text-center py-16 text-slate-400">No customers found.</div>}
        {customers.map((c) => (
          <div key={c.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="flex items-center px-5 py-4 gap-4">
              <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center text-orange-600 font-bold text-lg">
                {c.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1">
                <p className="font-semibold text-slate-800">{c.name}</p>
                <p className="text-sm text-slate-400">{c.phone || 'No phone'}</p>
              </div>
              <div className="text-right">
                <p className={`text-lg font-bold ${c.balance > 0 ? 'text-red-600' : 'text-green-600'}`}>{formatCurrency(c.balance)}</p>
                <p className="text-xs text-slate-400">{c.balance > 0 ? 'Outstanding' : 'Settled'}</p>
              </div>
              <div className="flex gap-2 ml-2">
                {c.balance > 0 && (
                  <button onClick={() => setPayModal(c)} className="bg-green-600 hover:bg-green-700 text-white text-sm px-3 py-1.5 rounded-lg font-semibold transition-colors">
                    + Pay
                  </button>
                )}
                <button onClick={() => setExpanded(expanded === c.id ? null : c.id)} className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100">
                  {expanded === c.id ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>
              </div>
            </div>

            {/* Ledger */}
            {expanded === c.id && c.ledger.length > 0 && (
              <div className="border-t border-slate-100 px-5 py-3">
                <p className="text-xs font-bold text-slate-500 uppercase mb-2">Transaction History</p>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {[...c.ledger].reverse().map((e, i) => (
                    <div key={i} className="flex justify-between text-sm">
                      <div>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded mr-2 ${e.type === 'CREDIT' ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>{e.type}</span>
                        <span className="text-slate-500">{e.notes || '—'}</span>
                      </div>
                      <div className="text-right">
                        <span className={`font-bold ${e.type === 'CREDIT' ? 'text-red-600' : 'text-green-600'}`}>{e.type === 'CREDIT' ? '+' : '-'}{formatCurrency(e.amount)}</span>
                        <p className="text-xs text-slate-400">{parseServerDate(e.date).toLocaleDateString()}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Payment Modal */}
      {payModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h2 className="text-lg font-bold">Log Payment</h2>
              <button onClick={() => setPayModal(null)}><X size={20} className="text-slate-400" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-orange-50 rounded-xl p-4">
                <p className="font-semibold text-slate-800">{payModal.name}</p>
                <p className="text-orange-600 font-bold">Outstanding: {formatCurrency(payModal.balance)}</p>
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
    </div>
  );
}
