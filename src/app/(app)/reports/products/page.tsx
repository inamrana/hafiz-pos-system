'use client';

import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Search, Download, Printer } from 'lucide-react';
import * as XLSX from 'xlsx';
import { formatCurrency } from '@/lib/utils';

interface ProductRow {
  item_id: number | null;
  name: string;
  category: string;
  quantitySold: number;
  revenue: number;
  cost: number;
  profit: number;
}

interface ProductData {
  products: ProductRow[];
  totals: { totalRevenue: number; totalCost: number; totalProfit: number; totalQuantity: number; productCount: number };
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

export default function ProductReportPage() {
  const [data, setData] = useState<ProductData | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<Period>('MONTH');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [shop, setShop] = useState({ shopName: 'Mart POS' });

  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then((s) => setShop({ shopName: s.shopName || 'Mart POS' }));
  }, []);

  useEffect(() => {
    setLoading(true);
    const range = periodRange(period, customFrom, customTo);
    const params = new URLSearchParams();
    if (range.from) params.set('from', range.from);
    if (range.to) params.set('to', range.to);
    fetch(`/api/reports/products?${params.toString()}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [period, customFrom, customTo]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.products;
    return data.products.filter((p) => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
  }, [data, search]);

  const cards = data
    ? [
        { label: 'Products Sold', value: data.totals.productCount.toLocaleString(), color: 'text-slate-800' },
        { label: 'Units Sold', value: data.totals.totalQuantity.toLocaleString(), color: 'text-slate-800' },
        { label: 'Total Revenue', value: formatCurrency(data.totals.totalRevenue), color: 'text-slate-800' },
        { label: 'Total Cost', value: formatCurrency(data.totals.totalCost), color: 'text-slate-800' },
        { label: 'Net Profit', value: formatCurrency(data.totals.totalProfit), color: data.totals.totalProfit >= 0 ? 'text-green-600' : 'text-red-600' },
      ]
    : [];

  const exportExcel = () => {
    const rows = filtered.map((p) => ({
      Product: p.name, Category: p.category, QuantitySold: p.quantitySold,
      Revenue: p.revenue, Cost: p.cost, Profit: p.profit,
      Margin: p.revenue > 0 ? `${((p.profit / p.revenue) * 100).toFixed(1)}%` : '—',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Product Report');
    XLSX.writeFile(wb, `product-report-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="print-only p-4">
        <h1 className="text-xl font-bold">{shop.shopName}</h1>
        <p className="text-sm">Product Report</p>
      </div>

      <div className="no-print flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-violet-100 text-violet-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <BarChart3 size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Product Report</h1>
            <p className="text-slate-500 text-sm mt-0.5">What sold, what it cost, and the profit per product.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => window.print()} className="flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2.5 rounded-xl font-semibold transition-colors">
            <Printer size={16} /> Print
          </button>
          <button onClick={exportExcel} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl font-semibold transition-colors shadow-sm">
            <Download size={16} /> Export Excel
          </button>
        </div>
      </div>

      {/* Period filters */}
      <div className="no-print flex flex-wrap items-center gap-2">
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

      <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
            <p className="text-sm font-medium text-slate-400">{c.label}</p>
            <p className={`text-2xl font-black leading-tight mt-1 ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="no-print px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div className="relative w-full sm:w-80">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search product or category..."
              className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>
          <p className="text-xs text-slate-400">{filtered.length} product{filtered.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs font-bold text-slate-500 uppercase">
                <th className="px-5 py-3">Product</th>
                <th className="px-5 py-3">Category</th>
                <th className="px-5 py-3 text-right">Qty Sold</th>
                <th className="px-5 py-3 text-right">Revenue</th>
                <th className="px-5 py-3 text-right">Cost</th>
                <th className="px-5 py-3 text-right">Profit</th>
                <th className="px-5 py-3 text-right">Margin</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-10 text-slate-400 text-sm">Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-10 text-slate-400 text-sm">No products sold in this period.</td></tr>
              ) : (
                filtered.map((p) => (
                  <tr key={`${p.item_id ?? 'custom'}-${p.name}`} className="border-b border-slate-100 hover:bg-slate-50 text-sm">
                    <td className="px-5 py-3 font-semibold text-slate-800">{p.name}</td>
                    <td className="px-5 py-3">
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full border bg-slate-50 border-slate-200 text-slate-500">{p.category}</span>
                    </td>
                    <td className="px-5 py-3 text-right text-slate-600">{p.quantitySold}</td>
                    <td className="px-5 py-3 text-right font-bold text-slate-800">{formatCurrency(p.revenue)}</td>
                    <td className="px-5 py-3 text-right text-slate-500">{formatCurrency(p.cost)}</td>
                    <td className={`px-5 py-3 text-right font-semibold ${p.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(p.profit)}</td>
                    <td className={`px-5 py-3 text-right text-xs font-bold ${p.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {p.revenue > 0 ? `${((p.profit / p.revenue) * 100).toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {!loading && filtered.length > 0 && (
              <tfoot>
                <tr className="bg-slate-50 border-t border-slate-200 text-sm font-bold">
                  <td className="px-5 py-3" colSpan={2}>Total</td>
                  <td className="px-5 py-3 text-right">{filtered.reduce((s, p) => s + p.quantitySold, 0)}</td>
                  <td className="px-5 py-3 text-right">{formatCurrency(filtered.reduce((s, p) => s + p.revenue, 0))}</td>
                  <td className="px-5 py-3 text-right">{formatCurrency(filtered.reduce((s, p) => s + p.cost, 0))}</td>
                  <td className={`px-5 py-3 text-right ${filtered.reduce((s, p) => s + p.profit, 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatCurrency(filtered.reduce((s, p) => s + p.profit, 0))}
                  </td>
                  <td className="px-5 py-3"></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
