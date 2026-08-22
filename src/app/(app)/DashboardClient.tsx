'use client';

import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { TrendingUp, ShoppingBag, CreditCard, Package, AlertTriangle, Truck, CalendarClock } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

interface DashStats {
  todaySales: number;
  todayBills: number;
  monthlySales: number;
  monthlyBills: number;
  yearlySales: number;
  totalUdhaar: number;
  totalPayables: number;
  totalItems: number;
  lowStockItems: { id: number; name: string; quantity: number; category: string; unit: string }[];
  expiringBatches: { id: number; item_name: string; quantity: number; expiry_date: string; item_unit: string }[];
  dailyChart: { _id: string; total: number; count: number }[];
  topItems: { name: string; totalQty: number; totalRevenue: number }[];
}

export default function DashboardClient() {
  const [stats, setStats] = useState<DashStats | null>(null);

  useEffect(() => {
    fetch('/api/dashboard').then((r) => r.json()).then(setStats);
  }, []);

  if (!stats) return (
    <div className="p-6 flex items-center justify-center h-64 text-slate-400">Loading dashboard...</div>
  );

  const cards = [
    { label: "Today's Sales", value: formatCurrency(stats.todaySales), sub: `${stats.todayBills} bills`, icon: TrendingUp, color: 'bg-green-500' },
    { label: 'Monthly Sales', value: formatCurrency(stats.monthlySales), sub: `${stats.monthlyBills} bills`, icon: ShoppingBag, color: 'bg-blue-500' },
    { label: 'Total Udhaar', value: formatCurrency(stats.totalUdhaar), sub: 'Outstanding credit', icon: CreditCard, color: 'bg-orange-500' },
    { label: 'Supplier Payables', value: formatCurrency(stats.totalPayables), sub: 'Owed to suppliers', icon: Truck, color: 'bg-rose-500' },
    { label: 'Total Items', value: stats.totalItems.toLocaleString(), sub: `${stats.lowStockItems.length} low stock`, icon: Package, color: 'bg-purple-500' },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>
        <p className="text-slate-500 text-sm mt-0.5">{new Date().toLocaleDateString('en-PK', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
        {cards.map(({ label, value, sub, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 flex items-start gap-4">
            <div className={`${color} w-12 h-12 rounded-xl flex items-center justify-center text-white flex-shrink-0`}>
              <Icon size={22} />
            </div>
            <div>
              <p className="text-sm text-slate-500 font-medium">{label}</p>
              <p className="text-2xl font-black text-slate-800 leading-tight mt-0.5">{value}</p>
              <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Chart */}
        <div className="xl:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-base font-bold text-slate-700 mb-4">Sales – Last 7 Days</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={stats.dailyChart} barSize={32}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="_id" tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v) => `Rs.${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v) => formatCurrency(Number(v) || 0)} labelStyle={{ fontWeight: 600 }} />
              <Bar dataKey="total" fill="#3b82f6" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Top Items */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-base font-bold text-slate-700 mb-4">Top Sellers This Month</h2>
          {stats.topItems.length === 0 ? (
            <p className="text-sm text-slate-400">No sales yet this month.</p>
          ) : (
            <div className="space-y-3">
              {stats.topItems.map((t, i) => (
                <div key={t.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-500 text-xs font-bold flex items-center justify-center">{i + 1}</span>
                    <span className="text-sm font-medium text-slate-700">{t.name}</span>
                  </div>
                  <span className="text-sm font-bold text-slate-800">{formatCurrency(t.totalRevenue)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Low Stock */}
        {stats.lowStockItems.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-amber-200 p-6">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle size={18} className="text-amber-500" />
              <h2 className="text-base font-bold text-slate-700">Low Stock Alerts ({stats.lowStockItems.length})</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {stats.lowStockItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between bg-amber-50 rounded-xl px-4 py-3">
                  <div>
                    <p className="font-semibold text-sm text-slate-800">{item.name}</p>
                    <p className="text-xs text-slate-500">{item.category}</p>
                  </div>
                  <span className={`text-sm font-bold px-2 py-1 rounded-lg ${item.quantity === 0 ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'}`}>
                    {item.quantity} {item.unit} left
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Near-expiry */}
        {stats.expiringBatches.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-red-200 p-6">
            <div className="flex items-center gap-2 mb-4">
              <CalendarClock size={18} className="text-red-500" />
              <h2 className="text-base font-bold text-slate-700">Near-Expiry Stock ({stats.expiringBatches.length})</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {stats.expiringBatches.map((b) => {
                const expired = new Date(b.expiry_date) < new Date();
                return (
                  <div key={b.id} className="flex items-center justify-between bg-red-50 rounded-xl px-4 py-3">
                    <div>
                      <p className="font-semibold text-sm text-slate-800">{b.item_name}</p>
                      <p className="text-xs text-slate-500">{b.quantity} {b.item_unit}</p>
                    </div>
                    <span className={`text-xs font-bold px-2 py-1 rounded-lg ${expired ? 'bg-red-200 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                      {expired ? 'Expired' : new Date(b.expiry_date).toLocaleDateString()}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
