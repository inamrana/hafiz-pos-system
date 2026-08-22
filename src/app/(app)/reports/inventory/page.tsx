'use client';

import { useEffect, useState } from 'react';
import { Boxes, Printer, AlertTriangle, PackageX } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

interface CategoryRow {
  category: string;
  itemCount: number;
  totalQty: number;
  costValue: number;
  saleValue: number;
}

interface InventoryData {
  byCategory: CategoryRow[];
  totals: {
    totalItems: number;
    totalQty: number;
    totalCostValue: number;
    totalSaleValue: number;
    potentialProfit: number;
    lowStockCount: number;
    outOfStockCount: number;
  };
}

export default function InventoryReportPage() {
  const [data, setData] = useState<InventoryData | null>(null);
  const [shop, setShop] = useState({ shopName: 'Mart POS' });

  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then((s) => setShop({ shopName: s.shopName || 'Mart POS' }));
    fetch('/api/reports/inventory').then((r) => r.json()).then(setData);
  }, []);

  const cards = data
    ? [
        { label: 'Total Items', value: data.totals.totalItems.toLocaleString(), color: 'text-slate-800' },
        { label: 'Inventory Cost Value', value: formatCurrency(data.totals.totalCostValue), color: 'text-slate-800' },
        { label: 'Inventory Sale Value', value: formatCurrency(data.totals.totalSaleValue), color: 'text-slate-800' },
        { label: 'Potential Profit', value: formatCurrency(data.totals.potentialProfit), color: data.totals.potentialProfit >= 0 ? 'text-green-600' : 'text-red-600' },
      ]
    : [];

  return (
    <div className="p-6 space-y-6">
      <div className="print-only p-4">
        <h1 className="text-xl font-bold">{shop.shopName}</h1>
        <p className="text-sm">Inventory Report — {new Date().toLocaleDateString()}</p>
      </div>

      <div className="no-print flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-teal-100 text-teal-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <Boxes size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Inventory Report</h1>
            <p className="text-slate-500 text-sm mt-0.5">Current stock valuation, right now.</p>
          </div>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2.5 rounded-xl font-semibold transition-colors"
        >
          <Printer size={16} /> Print
        </button>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
            <p className="text-sm font-medium text-slate-400">{c.label}</p>
            <p className={`text-2xl font-black leading-tight mt-1 ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {data && (data.totals.lowStockCount > 0 || data.totals.outOfStockCount > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {data.totals.outOfStockCount > 0 && (
            <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl">
              <PackageX size={18} />
              <span className="font-semibold text-sm">{data.totals.outOfStockCount} item{data.totals.outOfStockCount !== 1 ? 's' : ''} out of stock</span>
            </div>
          )}
          {data.totals.lowStockCount > 0 && (
            <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-xl">
              <AlertTriangle size={18} />
              <span className="font-semibold text-sm">{data.totals.lowStockCount} item{data.totals.lowStockCount !== 1 ? 's' : ''} low on stock</span>
            </div>
          )}
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="font-bold text-slate-700">Value by Category</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs font-bold text-slate-500 uppercase">
                <th className="px-5 py-3">Category</th>
                <th className="px-5 py-3 text-center">Items</th>
                <th className="px-5 py-3 text-center">Total Qty</th>
                <th className="px-5 py-3 text-right">Cost Value</th>
                <th className="px-5 py-3 text-right">Sale Value</th>
                <th className="px-5 py-3 text-right">Potential Profit</th>
              </tr>
            </thead>
            <tbody>
              {!data || data.byCategory.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-10 text-slate-400 text-sm">No stock yet.</td></tr>
              ) : (
                data.byCategory.map((c) => (
                  <tr key={c.category} className="border-b border-slate-100 hover:bg-slate-50 text-sm">
                    <td className="px-5 py-3">
                      <span className="bg-blue-50 text-blue-700 text-xs font-semibold px-2.5 py-1 rounded-full">{c.category}</span>
                    </td>
                    <td className="px-5 py-3 text-center text-slate-500">{c.itemCount}</td>
                    <td className="px-5 py-3 text-center text-slate-500">{c.totalQty}</td>
                    <td className="px-5 py-3 text-right text-slate-700">{formatCurrency(c.costValue)}</td>
                    <td className="px-5 py-3 text-right font-bold text-slate-800">{formatCurrency(c.saleValue)}</td>
                    <td className={`px-5 py-3 text-right font-semibold ${c.saleValue - c.costValue >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrency(c.saleValue - c.costValue)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {data && data.byCategory.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-200 font-bold text-sm bg-slate-50">
                  <td className="px-5 py-3">Total</td>
                  <td className="px-5 py-3 text-center text-slate-600">{data.totals.totalItems}</td>
                  <td className="px-5 py-3 text-center text-slate-600">{data.totals.totalQty}</td>
                  <td className="px-5 py-3 text-right text-slate-700">{formatCurrency(data.totals.totalCostValue)}</td>
                  <td className="px-5 py-3 text-right text-slate-800">{formatCurrency(data.totals.totalSaleValue)}</td>
                  <td className={`px-5 py-3 text-right ${data.totals.potentialProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(data.totals.potentialProfit)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
