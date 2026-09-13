'use client';

import { useEffect, useState } from 'react';
import { PackageCheck, Printer } from 'lucide-react';
import { formatCurrency, localDateInput, parseServerDate } from '@/lib/utils';

interface SoldItem {
  bill_id: number;
  bill_number: string;
  customer_name: string;
  created_at: string;
  bill_item_id: number;
  item_id: number | null;
  name: string;
  quantity: number;
  price: number;
  total: number;
  cost: number;
  profit: number;
}

interface SoldTodayData {
  items: SoldItem[];
  totals: {
    uniqueProducts: number;
    totalQuantity: number;
    totalRevenue: number;
    totalCost: number;
    totalProfit: number;
    billCount: number;
  };
}

// One color per bill, cycling through a fixed palette so items bought together in
// the same sale are visually grouped — same idea as the category tiles in billing.
const BILL_COLORS = [
  { bar: 'bg-blue-500', chip: 'bg-blue-50 text-blue-700 border-blue-200' },
  { bar: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { bar: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 border-amber-200' },
  { bar: 'bg-violet-500', chip: 'bg-violet-50 text-violet-700 border-violet-200' },
  { bar: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700 border-rose-200' },
  { bar: 'bg-cyan-500', chip: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  { bar: 'bg-orange-500', chip: 'bg-orange-50 text-orange-700 border-orange-200' },
  { bar: 'bg-teal-500', chip: 'bg-teal-50 text-teal-700 border-teal-200' },
];

function billColor(billId: number) {
  return BILL_COLORS[billId % BILL_COLORS.length];
}

export default function SoldTodayPage() {
  const [date, setDate] = useState(() => localDateInput());
  const [data, setData] = useState<SoldTodayData | null>(null);
  const [loading, setLoading] = useState(false);
  const [shop, setShop] = useState({ shopName: 'Mart POS' });

  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then((s) => setShop({ shopName: s.shopName || 'Mart POS' }));
  }, []);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/reports/sold-today?date=${date}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [date]);

  const prettyDate = new Date(date + 'T00:00:00').toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });

  // Group the flat item list into bills, preserving the order they came in (oldest first).
  const bills: { bill_id: number; bill_number: string; customer_name: string; created_at: string; items: SoldItem[] }[] = [];
  const billIndex = new Map<number, number>();
  for (const item of data?.items || []) {
    if (!billIndex.has(item.bill_id)) {
      billIndex.set(item.bill_id, bills.length);
      bills.push({ bill_id: item.bill_id, bill_number: item.bill_number, customer_name: item.customer_name, created_at: item.created_at, items: [] });
    }
    bills[billIndex.get(item.bill_id)!].items.push(item);
  }

  const cards = data
    ? [
        { label: 'Products Sold', value: data.totals.uniqueProducts.toLocaleString(), color: 'text-slate-800' },
        { label: 'Units Sold', value: data.totals.totalQuantity.toLocaleString(), color: 'text-slate-800' },
        { label: 'Revenue', value: formatCurrency(data.totals.totalRevenue), color: 'text-slate-800' },
        { label: 'Profit', value: formatCurrency(data.totals.totalProfit), color: data.totals.totalProfit >= 0 ? 'text-green-600' : 'text-red-600' },
        { label: 'Bills', value: data.totals.billCount.toLocaleString(), color: 'text-slate-800' },
      ]
    : [];

  return (
    <div className="p-6 space-y-6">
      <div className="print-only p-4">
        <h1 className="text-xl font-bold">{shop.shopName}</h1>
        <p className="text-sm">Sold Today — {prettyDate}</p>
      </div>

      <div className="no-print flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <PackageCheck size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Sold Today</h1>
            <p className="text-slate-500 text-sm mt-0.5">Every item sold, grouped by sale — same color means bought together.</p>
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

      <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
            <p className="text-sm font-medium text-slate-400">{c.label}</p>
            <p className={`text-2xl font-black leading-tight mt-1 ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="font-bold text-slate-700">Sales on {prettyDate}</h2>
        </div>
        <div className="p-4 space-y-3">
          {loading ? (
            <p className="text-center py-10 text-slate-400 text-sm">Loading...</p>
          ) : bills.length === 0 ? (
            <p className="text-center py-10 text-slate-400 text-sm">Nothing sold on this date.</p>
          ) : (
            bills.map((bill) => {
              const color = billColor(bill.bill_id);
              const billTotal = bill.items.reduce((s, i) => s + i.total, 0);
              return (
                <div key={bill.bill_id} className="flex gap-3">
                  <div className={`w-1.5 rounded-full flex-shrink-0 ${color.bar}`} />
                  <div className="flex-1 min-w-0 pb-1">
                    <div className="flex items-center justify-between gap-3 mb-1.5 flex-wrap">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full border flex-shrink-0 ${color.chip}`}>{bill.customer_name}</span>
                        <span className="text-xs text-slate-400 font-mono truncate">{bill.bill_number}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-400 flex-shrink-0">
                        <span>{parseServerDate(bill.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        <span className="font-bold text-slate-600">{formatCurrency(billTotal)}</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      {bill.items.map((it) => (
                        <div key={it.bill_item_id} className="flex items-center justify-between text-sm px-3 py-1.5 rounded-lg bg-slate-50">
                          <span className="text-slate-700 truncate">{it.name}</span>
                          <div className="flex items-center gap-4 flex-shrink-0 text-slate-500">
                            <span>× {it.quantity}</span>
                            <span className="font-semibold text-slate-800 w-16 text-right">{formatCurrency(it.total)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
