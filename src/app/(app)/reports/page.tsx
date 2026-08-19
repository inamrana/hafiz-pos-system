'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, Printer, ArrowUpRight, ArrowDownRight, Download, Undo2, X, Eye } from 'lucide-react';
import * as XLSX from 'xlsx';
import { formatCurrency } from '@/lib/utils';

interface BillItem {
  id: number;
  name: string;
  quantity: number;
  price: number;
  total: number;
  returned_quantity: number;
}

interface Bill {
  id: number;
  bill_number: string;
  customer_name: string;
  payment_type: 'CASH' | 'CARD' | 'UDHAAR';
  status: 'COMPLETED' | 'RETURNED' | 'PARTIAL_RETURN';
  subtotal: number;
  discount: number;
  total: number;
  cashier_name: string;
  created_at: string;
  items?: BillItem[];
}

type Period = 'TODAY' | 'MONTH' | 'YEAR' | 'ALL' | 'CUSTOM';

function periodRange(period: Period, from: string, to: string): { from?: string; to?: string } {
  const now = new Date();
  if (period === 'TODAY') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { from: start.toISOString() };
  }
  if (period === 'MONTH') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: start.toISOString() };
  }
  if (period === 'YEAR') {
    const start = new Date(now.getFullYear(), 0, 1);
    return { from: start.toISOString() };
  }
  if (period === 'CUSTOM') {
    return {
      from: from ? new Date(from).toISOString() : undefined,
      to: to ? new Date(new Date(to).getTime() + 86400000).toISOString() : undefined,
    };
  }
  return {};
}

export default function ReportsPage() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [filterType, setFilterType] = useState<'ALL' | 'CASH' | 'CARD' | 'UDHAAR'>('ALL');
  const [period, setPeriod] = useState<Period>('MONTH');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [shop, setShop] = useState({ shopName: 'Mart POS', address: '', phone: '', receiptFooter: '' });

  const [printBill, setPrintBill] = useState<Bill | null>(null);
  const [returnBill, setReturnBill] = useState<Bill | null>(null);
  const [returnQtys, setReturnQtys] = useState<Record<number, number>>({});
  const [refundMethod, setRefundMethod] = useState<'CASH' | 'UDHAAR_ADJUST'>('CASH');
  const [returnMsg, setReturnMsg] = useState('');
  const [processingReturn, setProcessingReturn] = useState(false);

  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then((s) => setShop({
      shopName: s.shopName || 'Mart POS', address: s.address || '', phone: s.phone || '', receiptFooter: s.receiptFooter || '',
    }));
  }, []);

  const loadBills = async () => {
    setLoading(true);
    try {
      const range = periodRange(period, customFrom, customTo);
      const params = new URLSearchParams({ limit: '500' });
      if (range.from) params.set('from', range.from);
      if (range.to) params.set('to', range.to);
      if (filterType !== 'ALL') params.set('type', filterType);
      const res = await fetch(`/api/bills?${params.toString()}`);
      if (res.ok) setBills(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadBills(); }, [period, filterType, customFrom, customTo]);

  const filteredBills = useMemo(
    () =>
      bills.filter(
        (b) =>
          b.bill_number.toLowerCase().includes(search.toLowerCase()) ||
          b.customer_name.toLowerCase().includes(search.toLowerCase())
      ),
    [bills, search]
  );

  const totalSales = filteredBills.reduce((sum, b) => sum + b.total, 0);
  const totalDiscounts = filteredBills.reduce((sum, b) => sum + b.discount, 0);
  const cashSales = filteredBills.filter((b) => b.payment_type === 'CASH').reduce((sum, b) => sum + b.total, 0);
  const cardSales = filteredBills.filter((b) => b.payment_type === 'CARD').reduce((sum, b) => sum + b.total, 0);
  const udhaarSales = filteredBills.filter((b) => b.payment_type === 'UDHAAR').reduce((sum, b) => sum + b.total, 0);

  const exportExcel = () => {
    const rows = filteredBills.map((b) => ({
      Invoice: b.bill_number, Customer: b.customer_name, Date: new Date(b.created_at).toLocaleString(),
      Type: b.payment_type, Status: b.status, Subtotal: b.subtotal, Discount: b.discount, Total: b.total, Cashier: b.cashier_name,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Bills');
    XLSX.writeFile(wb, `sales-report-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const openPrint = async (b: Bill) => {
    const res = await fetch(`/api/bills?number=${encodeURIComponent(b.bill_number)}`);
    const full = await res.json();
    setPrintBill(full);
    setTimeout(() => window.print(), 100);
  };

  const openReturn = async (b: Bill) => {
    const res = await fetch(`/api/bills?number=${encodeURIComponent(b.bill_number)}`);
    const full: Bill = await res.json();
    setReturnBill(full);
    setRefundMethod(full.payment_type === 'UDHAAR' ? 'UDHAAR_ADJUST' : 'CASH');
    setReturnQtys({});
    setReturnMsg('');
  };

  const submitReturn = async () => {
    if (!returnBill) return;
    const lines = Object.entries(returnQtys)
      .filter(([, q]) => q > 0)
      .map(([billItemId, quantity]) => ({ billItemId: Number(billItemId), quantity }));
    if (lines.length === 0) { setReturnMsg('Select a quantity to return.'); return; }
    setProcessingReturn(true);
    try {
      const res = await fetch('/api/returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billId: returnBill.id, lines, refundMethod }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setReturnMsg(data.error || 'Return failed');
        return;
      }
      setReturnBill(null);
      loadBills();
    } finally {
      setProcessingReturn(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Print-only single bill reprint */}
      {printBill && (
        <div className="print-only p-8 font-mono text-sm">
          <div className="text-center mb-4">
            <h1 className="text-xl font-bold">{shop.shopName}</h1>
            {shop.address && <p>{shop.address}</p>}
            {shop.phone && <p>{shop.phone}</p>}
            <p className="mt-1 font-bold">SALES RECEIPT (REPRINT)</p>
            <p>Bill #: {printBill.bill_number}</p>
            <p>{new Date(printBill.created_at).toLocaleString()}</p>
          </div>
          <table className="w-full">
            <thead><tr className="border-b border-dashed border-black"><th className="text-left">Item</th><th className="text-center">Qty</th><th className="text-right">Price</th><th className="text-right">Total</th></tr></thead>
            <tbody>
              {(printBill.items || []).map((i) => (
                <tr key={i.id}><td>{i.name}</td><td className="text-center">{i.quantity}</td><td className="text-right">{i.price}</td><td className="text-right">{i.total}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-dashed border-black mt-2 pt-2 text-right">
            <p>Subtotal: {formatCurrency(printBill.subtotal)}</p>
            {printBill.discount > 0 && <p>Discount: - {formatCurrency(printBill.discount)}</p>}
            <p className="text-lg font-bold">Total: {formatCurrency(printBill.total)}</p>
            <p>Payment: {printBill.payment_type}</p>
          </div>
          <p className="text-center mt-6 text-xs">{shop.receiptFooter}</p>
        </div>
      )}

      <div className="no-print space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Bills</h1>
            <p className="text-slate-500 text-sm mt-0.5">Search invoices, filter by period, export, and process returns</p>
          </div>
          <button
            onClick={exportExcel}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl font-semibold transition-colors shadow-sm"
          >
            <Download size={18} /> Export Excel
          </button>
        </div>

        {/* Period filters */}
        <div className="flex flex-wrap items-center gap-2">
          {(['TODAY', 'MONTH', 'YEAR', 'ALL', 'CUSTOM'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${period === p ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}
            >
              {p === 'TODAY' ? 'Today' : p === 'MONTH' ? 'This Month' : p === 'YEAR' ? 'This Year' : p === 'ALL' ? 'All Time' : 'Custom Range'}
            </button>
          ))}
          {period === 'CUSTOM' && (
            <div className="flex items-center gap-2">
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2 text-sm" />
              <span className="text-slate-400 text-sm">to</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2 text-sm" />
            </div>
          )}
        </div>

        {/* Financial Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
            <p className="text-sm font-medium text-slate-400">Total Volume</p>
            <p className="text-2xl font-black text-slate-800 leading-tight mt-1">{formatCurrency(totalSales)}</p>
            <p className="text-xs text-slate-500 mt-2 flex items-center gap-1"><ArrowUpRight size={14} className="text-green-500" /> {filteredBills.length} invoices</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
            <p className="text-sm font-medium text-slate-400">Cash Sales</p>
            <p className="text-2xl font-black text-slate-800 leading-tight mt-1">{formatCurrency(cashSales)}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
            <p className="text-sm font-medium text-slate-400">Card Sales</p>
            <p className="text-2xl font-black text-slate-800 leading-tight mt-1">{formatCurrency(cardSales)}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
            <p className="text-sm font-medium text-slate-400">Udhaar Sales</p>
            <p className="text-2xl font-black text-slate-800 leading-tight mt-1">{formatCurrency(udhaarSales)}</p>
            <p className="text-xs text-slate-500 mt-2 flex items-center gap-1"><ArrowDownRight size={14} className="text-orange-500" /> Booked to credit</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
            <p className="text-sm font-medium text-slate-400">Discounts Given</p>
            <p className="text-2xl font-black text-slate-800 leading-tight mt-1">{formatCurrency(totalDiscounts)}</p>
          </div>
        </div>

        {/* Filters and List */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
            <div className="relative w-full sm:w-80">
              <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search invoice or customer..." className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
            </div>
            <div className="flex bg-slate-100 p-1 rounded-xl">
              {(['ALL', 'CASH', 'CARD', 'UDHAAR'] as const).map((t) => (
                <button key={t} onClick={() => setFilterType(t)} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${filterType === t ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>{t}</button>
              ))}
            </div>
          </div>

          <div className="overflow-hidden border border-slate-100 rounded-xl overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs font-bold text-slate-500 uppercase">
                  <th className="px-5 py-3">Invoice #</th>
                  <th className="px-5 py-3">Customer</th>
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Total</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="text-center py-8 text-slate-400 text-sm">Loading invoices...</td></tr>
                ) : filteredBills.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-8 text-slate-400 text-sm">No invoices match the filters.</td></tr>
                ) : (
                  filteredBills.map((b) => (
                    <tr key={b.id} className="border-b border-slate-100 hover:bg-slate-50 text-sm transition-colors">
                      <td className="px-5 py-3.5 font-semibold text-blue-600">{b.bill_number}</td>
                      <td className="px-5 py-3.5 text-slate-700">{b.customer_name}</td>
                      <td className="px-5 py-3.5 text-slate-500">{new Date(b.created_at).toLocaleDateString()}</td>
                      <td className="px-5 py-3.5">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${b.payment_type === 'CASH' ? 'bg-green-100 text-green-700' : b.payment_type === 'CARD' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>{b.payment_type}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${b.status === 'COMPLETED' ? 'bg-slate-100 text-slate-600' : b.status === 'RETURNED' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'}`}>{b.status.replace('_', ' ')}</span>
                      </td>
                      <td className="px-5 py-3.5 text-right font-bold text-slate-800">{formatCurrency(b.total)}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => openPrint(b)} title="Reprint" className="text-slate-400 hover:text-blue-600"><Printer size={15} /></button>
                          {b.status !== 'RETURNED' && (
                            <button onClick={() => openReturn(b)} title="Return items" className="text-slate-400 hover:text-red-600"><Undo2 size={15} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Return modal */}
      {returnBill && (
        <div className="no-print fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <div>
                <h2 className="text-lg font-bold">Return Items — {returnBill.bill_number}</h2>
                <p className="text-xs text-slate-400">{returnBill.customer_name}</p>
              </div>
              <button onClick={() => setReturnBill(null)}><X size={20} className="text-slate-400" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-2">
                {(returnBill.items || []).map((i) => {
                  const remaining = i.quantity - i.returned_quantity;
                  if (remaining <= 0) return (
                    <div key={i.id} className="flex items-center justify-between text-sm text-slate-300">
                      <span>{i.name}</span><span>Fully returned</span>
                    </div>
                  );
                  return (
                    <div key={i.id} className="flex items-center justify-between gap-3">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-700">{i.name}</p>
                        <p className="text-xs text-slate-400">Sold: {i.quantity} · Returnable: {remaining} · {formatCurrency(i.price)} each</p>
                      </div>
                      <input
                        type="number" min="0" max={remaining} step="0.01"
                        value={returnQtys[i.id] || ''}
                        onChange={(e) => setReturnQtys({ ...returnQtys, [i.id]: Math.min(Number(e.target.value) || 0, remaining) })}
                        className="w-20 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-red-400"
                      />
                    </div>
                  );
                })}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Refund Method</label>
                <div className="flex gap-2">
                  <button onClick={() => setRefundMethod('CASH')} className={`flex-1 py-2 rounded-xl text-sm font-semibold ${refundMethod === 'CASH' ? 'bg-green-500 text-white' : 'bg-slate-100 text-slate-500'}`}>Cash Refund</button>
                  <button
                    onClick={() => setRefundMethod('UDHAAR_ADJUST')}
                    disabled={returnBill.payment_type !== 'UDHAAR'}
                    className={`flex-1 py-2 rounded-xl text-sm font-semibold disabled:opacity-40 ${refundMethod === 'UDHAAR_ADJUST' ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-500'}`}
                  >
                    Adjust Udhaar
                  </button>
                </div>
              </div>
              {returnMsg && <p className="text-sm text-red-600 font-medium">{returnMsg}</p>}
            </div>
            <div className="flex gap-3 p-6 pt-0">
              <button onClick={() => setReturnBill(null)} className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl font-semibold hover:bg-slate-50">Cancel</button>
              <button onClick={submitReturn} disabled={processingReturn} className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white py-2.5 rounded-xl font-semibold flex items-center justify-center gap-2">
                <Eye size={16} /> {processingReturn ? 'Processing...' : 'Confirm Return'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
