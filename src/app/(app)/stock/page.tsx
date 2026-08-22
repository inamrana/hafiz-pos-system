'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Plus, Search, Edit2, Trash2, AlertTriangle, X, Upload, Download, Barcode as BarcodeIcon } from 'lucide-react';
import * as XLSX from 'xlsx';
import { formatCurrency } from '@/lib/utils';

interface Item {
  id: number;
  barcode: string | null;
  name: string;
  category: string;
  cost_price: number;
  sale_price: number;
  quantity: number;
  unit: string;
  unit_type: 'COUNT' | 'WEIGHT';
  low_stock_threshold: number;
}

const emptyForm = {
  barcode: '', name: '', category: 'General', costPrice: '', salePrice: '', quantity: '',
  unit: 'Pcs', unitType: 'COUNT' as 'COUNT' | 'WEIGHT', lowStockThreshold: '5',
};

function StockPageClient() {
  const searchParams = useSearchParams();
  const filterParam = searchParams.get('filter');

  const [items, setItems] = useState<Item[]>([]);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<Item | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [showLowStockOnly, setShowLowStockOnly] = useState(false);
  const [importError, setImportError] = useState('');
  const [importSummary, setImportSummary] = useState('');

  const load = async (q = '') => {
    const res = await fetch(`/api/items?q=${encodeURIComponent(q)}`);
    setItems(await res.json());
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { const t = setTimeout(() => load(search), 250); return () => clearTimeout(t); }, [search]);
  useEffect(() => { setShowLowStockOnly(filterParam === 'low'); }, [filterParam]);

  const openAdd = () => { setEditItem(null); setForm(emptyForm); setShowModal(true); };
  const openEdit = (item: Item) => {
    setEditItem(item);
    setForm({
      barcode: item.barcode || '', name: item.name, category: item.category,
      costPrice: String(item.cost_price), salePrice: String(item.sale_price), quantity: String(item.quantity),
      unit: item.unit, unitType: item.unit_type, lowStockThreshold: String(item.low_stock_threshold),
    });
    setShowModal(true);
  };

  const save = async () => {
    setLoading(true);
    const payload = {
      barcode: form.barcode || null,
      name: form.name,
      category: form.category,
      cost_price: Number(form.costPrice) || 0,
      sale_price: Number(form.salePrice) || 0,
      quantity: Number(form.quantity) || 0,
      unit: form.unit,
      unit_type: form.unitType,
      low_stock_threshold: Number(form.lowStockThreshold) || 5,
    };
    const res = editItem
      ? await fetch('/api/items', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editItem.id, ...payload }) })
      : await fetch('/api/items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Failed to save item');
    } else {
      setShowModal(false);
      load(search);
    }
    setLoading(false);
  };

  const del = async (id: number) => {
    if (!confirm('Delete this item?')) return;
    await fetch(`/api/items?id=${id}`, { method: 'DELETE' });
    load(search);
  };

  const displayedItems = items.filter((i) => !showLowStockOnly || i.quantity <= i.low_stock_threshold);

  const exportExcel = () => {
    const rows = items.map((i) => ({
      Barcode: i.barcode || '', Name: i.name, Category: i.category, CostPrice: i.cost_price,
      SalePrice: i.sale_price, Quantity: i.quantity, Unit: i.unit, UnitType: i.unit_type, LowStockThreshold: i.low_stock_threshold,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Stock');
    XLSX.writeFile(wb, `stock-export-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const importExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportError('');
    setImportSummary('');
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);

      // Match column headers loosely (case/space/underscore-insensitive) so files exported
      // from other tools (e.g. "Buy Price", "Sell Price", "Stock", "Low Stock Alert") still import.
      const normalize = (s: string) => s.toLowerCase().replace(/[\s_-]/g, '');
      const field = (row: Record<string, unknown>, aliases: string[]): unknown => {
        const normalized = new Map(Object.entries(row).map(([k, v]) => [normalize(k), v]));
        for (const alias of aliases) {
          const value = normalized.get(normalize(alias));
          if (value !== undefined && value !== null && value !== '') return value;
        }
        return undefined;
      };

      let created = 0;
      let failed = 0;
      for (const row of rows) {
        const name = String(field(row, ['Name']) || '').trim();
        if (!name) { failed++; continue; }
        const payload = {
          barcode: field(row, ['Barcode']) || null,
          name,
          category: String(field(row, ['Category']) || 'General'),
          cost_price: Number(field(row, ['CostPrice', 'Cost Price', 'BuyPrice', 'Buy Price', 'Cost']) ?? 0),
          sale_price: Number(field(row, ['SalePrice', 'Sale Price', 'SellPrice', 'Sell Price', 'Price']) ?? 0),
          quantity: Number(field(row, ['Quantity', 'Stock', 'Qty']) ?? 0),
          unit: String(field(row, ['Unit']) || 'Pcs'),
          unit_type: field(row, ['UnitType', 'Unit Type']) === 'WEIGHT' ? 'WEIGHT' : 'COUNT',
          low_stock_threshold: Number(field(row, ['LowStockThreshold', 'Low Stock Threshold', 'Low Stock Alert']) ?? 5),
        };
        const res = await fetch('/api/items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (res.ok) created++; else failed++;
      }
      setImportSummary(`Imported ${created} item(s)${failed ? `, ${failed} failed` : ''}.`);
      load(search);
    } catch {
      setImportError('Could not read the Excel file. Expected columns include Name, Category, Cost/Buy Price, Sale/Sell Price, Quantity/Stock, Unit, Barcode.');
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Stock & Inventory</h1>
          <p className="text-slate-500 text-sm mt-0.5">{items.length} items total</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportExcel} className="flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2.5 rounded-xl font-semibold transition-colors">
            <Download size={16} /> Export
          </button>
          <label className="flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2.5 rounded-xl font-semibold transition-colors cursor-pointer">
            <Upload size={16} /> Import
            <input type="file" accept=".xlsx,.xls,.csv" onChange={importExcel} className="hidden" />
          </label>
          <button onClick={openAdd} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl font-semibold transition-colors">
            <Plus size={18} /> Add Item
          </button>
        </div>
      </div>

      {importSummary && <div className="mb-4 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-xl text-sm font-medium">{importSummary}</div>}
      {importError && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm font-medium">{importError}</div>}

      {items.filter((i) => i.quantity <= i.low_stock_threshold).length > 0 && (
        <div className="mb-4 flex items-center gap-3 bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-xl">
          <AlertTriangle size={18} />
          <span className="font-semibold">{items.filter((i) => i.quantity <= i.low_stock_threshold).length} items are low on stock</span>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-4 mb-4 items-center justify-between">
        <div className="relative flex-1 w-full">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, category, or barcode..."
            className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
        </div>
        <div className="flex bg-slate-200/60 p-1 rounded-xl">
          <button onClick={() => setShowLowStockOnly(false)} className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${!showLowStockOnly ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>All Items</button>
          <button onClick={() => setShowLowStockOnly(true)} className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${showLowStockOnly ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>Low Stock Only</button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-5 py-3 text-left text-xs font-bold text-slate-500 uppercase">ID</th>
              <th className="px-5 py-3 text-left text-xs font-bold text-slate-500 uppercase">Barcode</th>
              <th className="px-5 py-3 text-left text-xs font-bold text-slate-500 uppercase">Name</th>
              <th className="px-5 py-3 text-left text-xs font-bold text-slate-500 uppercase">Category</th>
              <th className="px-5 py-3 text-right text-xs font-bold text-slate-500 uppercase">Cost</th>
              <th className="px-5 py-3 text-right text-xs font-bold text-slate-500 uppercase">Sale Price</th>
              <th className="px-5 py-3 text-center text-xs font-bold text-slate-500 uppercase">Stock</th>
              <th className="px-5 py-3 text-left text-xs font-bold text-slate-500 uppercase">Unit</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {displayedItems.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-8 text-slate-400 text-sm">No items found.</td></tr>
            ) : (
              displayedItems.map((item) => (
                <tr key={item.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3.5 text-slate-400 text-sm font-mono">{item.id}</td>
                  <td className="px-5 py-3.5 text-slate-500 text-xs font-mono">
                    {item.barcode ? <span className="flex items-center gap-1"><BarcodeIcon size={12} />{item.barcode}</span> : '—'}
                  </td>
                  <td className="px-5 py-3.5 font-semibold text-sm">{item.name}</td>
                  <td className="px-5 py-3.5"><span className="bg-blue-50 text-blue-700 text-xs font-semibold px-2.5 py-1 rounded-full">{item.category}</span></td>
                  <td className="px-5 py-3.5 text-right text-sm text-slate-500">{formatCurrency(item.cost_price)}</td>
                  <td className="px-5 py-3.5 text-right font-bold text-sm text-slate-800">{formatCurrency(item.sale_price)}</td>
                  <td className="px-5 py-3.5 text-center">
                    <span className={`text-sm font-bold px-2 py-0.5 rounded-lg ${item.quantity <= item.low_stock_threshold ? 'bg-red-100 text-red-600' : item.quantity <= item.low_stock_threshold * 3 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                      {item.quantity}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-sm text-slate-500">{item.unit}{item.unit_type === 'WEIGHT' ? ' (wt)' : ''}</td>
                  <td className="px-5 py-3.5">
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => openEdit(item)} className="text-slate-400 hover:text-blue-600 transition-colors"><Edit2 size={15} /></button>
                      <button onClick={() => del(item.id)} className="text-slate-400 hover:text-red-600 transition-colors"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h2 className="text-lg font-bold">{editItem ? 'Edit Item' : 'Add New Item'}</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Item Name *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Barcode</label>
                <input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} placeholder="Scan or type barcode" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Category</label>
                  <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Item Type</label>
                  <select value={form.unitType} onChange={(e) => setForm({ ...form, unitType: e.target.value as 'COUNT' | 'WEIGHT' })} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="COUNT">Counted (pcs, box...)</option>
                    <option value="WEIGHT">Loose / Weighed (kg, g, ltr...)</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Unit Label</label>
                  <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="Pcs / Kg / Ltr" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Low Stock Alert Below</label>
                  <input type="number" value={form.lowStockThreshold} onChange={(e) => setForm({ ...form, lowStockThreshold: e.target.value })} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Cost Price (Rs)</label>
                  <input type="number" value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Sale Price (Rs) *</label>
                  <input type="number" value={form.salePrice} onChange={(e) => setForm({ ...form, salePrice: e.target.value })} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Quantity {form.unitType === 'WEIGHT' ? '(supports decimals, e.g. 2.5)' : ''}</label>
                <input type="number" step={form.unitType === 'WEIGHT' ? '0.01' : '1'} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                {editItem && <p className="text-xs text-slate-400 mt-1">Tip: use Purchases to add stock so cost/expiry batches stay accurate.</p>}
              </div>
            </div>
            <div className="flex gap-3 p-6 pt-0">
              <button onClick={() => setShowModal(false)} className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl font-semibold hover:bg-slate-50 transition-colors">Cancel</button>
              <button onClick={save} disabled={loading || !form.name} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white py-2.5 rounded-xl font-semibold transition-colors">
                {loading ? 'Saving...' : 'Save Item'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function StockPage() {
  return (
    <Suspense fallback={<div className="p-6 text-slate-400">Loading stock...</div>}>
      <StockPageClient />
    </Suspense>
  );
}
