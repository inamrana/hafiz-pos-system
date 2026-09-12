'use client';

import { useEffect, useState } from 'react';
import { CalendarDays, Printer, Receipt, X } from 'lucide-react';
import { formatCurrency, parseServerDate, localDateInput } from '@/lib/utils';

interface DailyBill {
  id: number;
  bill_number: string;
  created_at: string;
  customer_name: string;
  payment_type: string;
  status: string;
  total: number;
  item_count: number;
  cost: number;
  profit: number;
}

interface DailyData {
  bills: DailyBill[];
  totals: { billCount: number; totalSales: number; totalCost: number; netProfit: number };
}

interface BillDetailLine {
  id: number;
  item_id: number | null;
  name: string;
  quantity: number;
  price: number;
  total: number;
  returned_quantity: number;
  cost_price: number;
  cost: number;
  profit: number;
}

interface BillDetail {
  id: number;
  bill_number: string;
  customer_name: string;
  payment_type: string;
  status: string;
  subtotal: number;
  discount: number;
  total: number;
  created_at: string;
  items: BillDetailLine[];
  totalCost: number;
  profit: number;
}

export default function DailyReportPage() {
  const [date, setDate] = useState(() => localDateInput());
  const [data, setData] = useState<DailyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [shop, setShop] = useState({ shopName: 'Mart POS' });
  const [selectedBill, setSelectedBill] = useState<BillDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const openBillDetail = async (billId: number) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setSelectedBill(null);
    try {
      const res = await fetch(`/api/reports/bill-detail?id=${billId}`);
      if (res.ok) setSelectedBill(await res.json());
    } finally {
      setDetailLoading(false);
    }
  };

  const closeBillDetail = () => { setDetailOpen(false); setSelectedBill(null); };

  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then((s) => setShop({ shopName: s.shopName || 'Mart POS' }));
  }, []);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/reports/daily?date=${date}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [date]);

  const prettyDate = new Date(date + 'T00:00:00').toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });

  const cards = data
    ? [
        { label: 'Bills', value: data.totals.billCount.toLocaleString(), color: 'text-slate-800' },
        { label: 'Total Sales', value: formatCurrency(data.totals.totalSales), color: 'text-slate-800' },
        { label: 'Total Cost', value: formatCurrency(data.totals.totalCost), color: 'text-slate-800' },
        { label: 'Net Profit', value: formatCurrency(data.totals.netProfit), color: data.totals.netProfit >= 0 ? 'text-green-600' : 'text-red-600' },
      ]
    : [];

  return (
    <div className="p-6 space-y-6">
      {/* Print-only header */}
      <div className="print-only p-4">
        <h1 className="text-xl font-bold">{shop.shopName}</h1>
        <p className="text-sm">Daily Report — {prettyDate}</p>
      </div>

      <div className="no-print flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-orange-100 text-orange-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <CalendarDays size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Daily Report</h1>
            <p className="text-slate-500 text-sm mt-0.5">Detailed bill breakdown for any day.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            max={localDateInput()}
            onChange={(e) => setDate(e.target.value)}
            className="border border-slate-200 bg-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2.5 rounded-xl font-semibold transition-colors"
          >
            <Printer size={16} /> Print
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
            <p className="text-sm font-medium text-slate-400">{c.label}</p>
            <p className={`text-2xl font-black leading-tight mt-1 ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2">
          <Receipt size={16} className="text-slate-400" />
          <h2 className="font-bold text-slate-700">Bills on {prettyDate}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs font-bold text-slate-500 uppercase">
                <th className="px-5 py-3">Bill #</th>
                <th className="px-5 py-3">Time</th>
                <th className="px-5 py-3">Customer</th>
                <th className="px-5 py-3 text-center">Items</th>
                <th className="px-5 py-3 text-right">Total</th>
                <th className="px-5 py-3 text-right">Cost</th>
                <th className="px-5 py-3 text-right">Profit</th>
                <th className="px-5 py-3">Payment</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-10 text-slate-400 text-sm">Loading...</td></tr>
              ) : !data || data.bills.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-10 text-slate-400 text-sm">No bills found for this date.</td></tr>
              ) : (
                data.bills.map((b) => (
                  <tr
                    key={b.id}
                    onClick={() => openBillDetail(b.id)}
                    className="border-b border-slate-100 hover:bg-blue-50 text-sm cursor-pointer transition-colors"
                  >
                    <td className="px-5 py-3 font-semibold text-blue-600">{b.bill_number}</td>
                    <td className="px-5 py-3 text-slate-500">{parseServerDate(b.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="px-5 py-3 text-slate-700">{b.customer_name}</td>
                    <td className="px-5 py-3 text-center text-slate-500">{b.item_count}</td>
                    <td className="px-5 py-3 text-right font-bold text-slate-800">{formatCurrency(b.total)}</td>
                    <td className="px-5 py-3 text-right text-slate-500">{formatCurrency(b.cost)}</td>
                    <td className={`px-5 py-3 text-right font-semibold ${b.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(b.profit)}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${b.payment_type === 'CASH' ? 'bg-green-100 text-green-700' : b.payment_type === 'CARD' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>{b.payment_type}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bill detail modal */}
      {detailOpen && (
        <div className="no-print fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            {detailLoading || !selectedBill ? (
              <div className="p-10 text-center text-slate-400 text-sm">Loading bill...</div>
            ) : (
              <>
                <div className="flex items-center justify-between p-6 border-b border-slate-200">
                  <div>
                    <h2 className="text-lg font-bold text-slate-800">{selectedBill.bill_number}</h2>
                    <p className="text-xs text-slate-400">{parseServerDate(selectedBill.created_at).toLocaleString()}</p>
                  </div>
                  <button onClick={closeBillDetail}><X size={20} className="text-slate-400" /></button>
                </div>

                <div className="p-6 space-y-4">
                  <div className="flex items-center justify-between text-sm">
                    <div>
                      <p className="text-xs font-semibold text-slate-400 uppercase">Customer</p>
                      <p className="font-medium text-slate-700">{selectedBill.customer_name || 'Walk-in Customer'}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${selectedBill.payment_type === 'CASH' ? 'bg-green-100 text-green-700' : selectedBill.payment_type === 'CARD' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>{selectedBill.payment_type}</span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${selectedBill.status === 'COMPLETED' ? 'bg-slate-100 text-slate-600' : selectedBill.status === 'RETURNED' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'}`}>{selectedBill.status.replace('_', ' ')}</span>
                    </div>
                  </div>

                  <div className="border border-slate-100 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-left text-[11px] font-bold text-slate-500 uppercase">
                          <th className="px-3 py-2">Item</th>
                          <th className="px-3 py-2 text-right">Qty</th>
                          <th className="px-3 py-2 text-right">Sale Price</th>
                          <th className="px-3 py-2 text-right">Total</th>
                          <th className="px-3 py-2 text-right">Cost</th>
                          <th className="px-3 py-2 text-right">Profit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedBill.items.map((it) => (
                          <tr key={it.id} className="border-b border-slate-50 last:border-0">
                            <td className="px-3 py-2 text-slate-700">
                              {it.name}
                              {it.returned_quantity > 0 && (
                                <span className="ml-1.5 text-[10px] font-bold text-red-500">({it.returned_quantity} returned)</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-500">{it.quantity}</td>
                            <td className="px-3 py-2 text-right text-slate-500">{formatCurrency(it.price)}</td>
                            <td className="px-3 py-2 text-right text-slate-700 font-medium">{formatCurrency(it.total)}</td>
                            <td className="px-3 py-2 text-right text-slate-500">{formatCurrency(it.cost)}</td>
                            <td className={`px-3 py-2 text-right font-semibold ${it.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(it.profit)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="border-t border-slate-200 pt-3 space-y-1.5 text-sm">
                    <div className="flex justify-between text-slate-500">
                      <span>Subtotal</span>
                      <span>{formatCurrency(selectedBill.subtotal)}</span>
                    </div>
                    {selectedBill.discount > 0 && (
                      <div className="flex justify-between text-slate-500">
                        <span>Discount</span>
                        <span>- {formatCurrency(selectedBill.discount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-slate-800 text-base">
                      <span>Total</span>
                      <span>{formatCurrency(selectedBill.total)}</span>
                    </div>
                    <div className="flex justify-between text-slate-500">
                      <span>Total Cost</span>
                      <span>{formatCurrency(selectedBill.totalCost)}</span>
                    </div>
                    <div className={`flex justify-between font-bold ${selectedBill.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      <span>Profit</span>
                      <span>{formatCurrency(selectedBill.profit)}</span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
