'use client';

import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { TrendingUp, Printer } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

interface YearRow {
  year: string;
  count: number;
  total: number;
  cost: number;
  profit: number;
}

interface YearlyData {
  rows: YearRow[];
  totals: { billCount: number; totalSales: number; totalCost: number; netProfit: number };
}

export default function YearlyReportPage() {
  const [data, setData] = useState<YearlyData | null>(null);
  const [shop, setShop] = useState({ shopName: 'Mart POS' });

  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then((s) => setShop({ shopName: s.shopName || 'Mart POS' }));
    fetch('/api/reports/yearly').then((r) => r.json()).then(setData);
  }, []);

  const cards = data
    ? [
        { label: 'Total Bills', value: data.totals.billCount.toLocaleString(), color: 'text-slate-800' },
        { label: 'Total Sales', value: formatCurrency(data.totals.totalSales), color: 'text-slate-800' },
        { label: 'Total Cost', value: formatCurrency(data.totals.totalCost), color: 'text-slate-800' },
        { label: 'Net Profit', value: formatCurrency(data.totals.netProfit), color: data.totals.netProfit >= 0 ? 'text-green-600' : 'text-red-600' },
      ]
    : [];

  return (
    <div className="p-6 space-y-6">
      <div className="print-only p-4">
        <h1 className="text-xl font-bold">{shop.shopName}</h1>
        <p className="text-sm">Yearly Report — Last 5 Years</p>
      </div>

      <div className="no-print flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-rose-100 text-rose-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <TrendingUp size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Yearly Report</h1>
            <p className="text-slate-500 text-sm mt-0.5">Year-by-year performance for the last 5 years.</p>
          </div>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2.5 rounded-xl font-semibold transition-colors"
        >
          <Printer size={16} /> Print
        </button>
      </div>

      {/* 5-year combined totals — screen only. On print, the year-by-year table below
          is the report; a collective figure up top would read as "one lump sum" instead
          of a breakdown. */}
      <div className="no-print grid grid-cols-2 xl:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
            <p className="text-sm font-medium text-slate-400">{c.label} <span className="font-normal text-slate-300">(5yr)</span></p>
            <p className={`text-2xl font-black leading-tight mt-1 ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="no-print bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <h2 className="font-bold text-slate-700 mb-4">Year-over-Year Comparison</h2>
        {data && (
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={data.rows} barGap={6}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="year" tick={{ fontSize: 12, fill: '#94a3b8' }} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v) => formatCurrency(Number(v) || 0)} labelStyle={{ fontWeight: 600 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="total" name="Sales" fill="#eab308" radius={[4, 4, 0, 0]} />
              <Bar dataKey="cost" name="Cost" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="profit" name="Profit" fill="#ef4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="font-bold text-slate-700">Year-by-Year Breakdown</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs font-bold text-slate-500 uppercase">
                <th className="px-5 py-3">Year</th>
                <th className="px-5 py-3 text-center">Bills</th>
                <th className="px-5 py-3 text-right">Sales</th>
                <th className="px-5 py-3 text-right">Cost</th>
                <th className="px-5 py-3 text-right">Profit</th>
              </tr>
            </thead>
            <tbody>
              {data?.rows.map((r) => (
                <tr key={r.year} className="border-b border-slate-100 hover:bg-slate-50 text-sm">
                  <td className="px-5 py-3 font-semibold text-slate-700">{r.year}</td>
                  <td className="px-5 py-3 text-center text-slate-500">{r.count}</td>
                  <td className="px-5 py-3 text-right font-bold text-slate-800">{formatCurrency(r.total)}</td>
                  <td className="px-5 py-3 text-right text-slate-500">{formatCurrency(r.cost)}</td>
                  <td className={`px-5 py-3 text-right font-semibold ${r.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(r.profit)}</td>
                </tr>
              ))}
            </tbody>
            {data && (
              <tfoot>
                <tr className="bg-slate-50 border-t border-slate-200 text-sm font-bold">
                  <td className="px-5 py-3">5-Year Total</td>
                  <td className="px-5 py-3 text-center">{data.totals.billCount}</td>
                  <td className="px-5 py-3 text-right">{formatCurrency(data.totals.totalSales)}</td>
                  <td className="px-5 py-3 text-right">{formatCurrency(data.totals.totalCost)}</td>
                  <td className={`px-5 py-3 text-right ${data.totals.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(data.totals.netProfit)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
