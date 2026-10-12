'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Plus, Search, Edit2, Trash2, AlertTriangle, X, Upload, Download, Printer, Barcode as BarcodeIcon, SlidersHorizontal, Copy } from 'lucide-react';
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
  const [shop, setShop] = useState({ shopName: 'Mart POS' });
  const [notice, setNotice] = useState('');
  const [duplicates, setDuplicates] = useState<Item[][] | null>(null);
  const [merging, setMerging] = useState(false);

  const load = async (q = '') => {
    const res = await fetch(`/api/items?q=${encodeURIComponent(q)}`);
    setItems(await res.json());
  };

  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then((s) => setShop({ shopName: s.shopName || 'Mart POS' }));
    load();
  }, []);
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
      // Quantity is only sent for new items — existing stock changes go through
      // Manage Stock so they're recorded (and can't overwrite sales made meanwhile).
      ...(editItem ? {} : { quantity: Number(form.quantity) || 0 }),
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

  const del = async (item: Item) => {
    if (!confirm(`Delete "${item.name}"?`)) return;
    const res = await fetch(`/api/items?id=${item.id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Failed to delete item');
    } else {
      setNotice(data.archived
        ? `"${item.name}" removed from stock. It appears on past bills, so it is kept in old reports.`
        : `"${item.name}" deleted.`);
    }
    load(search);
  };

  const findDuplicates = async () => {
    const res = await fetch('/api/items?duplicates=1');
    setDuplicates(res.ok ? await res.json() : []);
  };

  /** Keeps `keep` and folds every other item in its duplicate group into it. */
  const mergeGroup = async (keep: Item, group: Item[]) => {
    const others = group.filter((g) => g.id !== keep.id);
    const total = group.reduce((s, g) => s + g.quantity, 0);
    if (!confirm(`Keep "${keep.name}" (ID ${keep.id}) and merge ${others.length} duplicate(s) into it?

Their sales history moves over and stock is added together (total ${total}).`)) return;
    setMerging(true);
    try {
      for (const o of others) {
        const res = await fetch('/api/items/merge', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceId: o.id, targetId: keep.id }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          alert(data.error || 'Merge failed');
          break;
        }
      }
      setNotice(`Merged duplicates into "${keep.name}".`);
      await findDuplicates();
      load(search);
    } finally {
      setMerging(false);
    }
  };

  const displayedItems = items.filter((i) => !showLowStockOnly || i.quantity <= i.low_stock_threshold);

  // Printed low-stock lists are for reordering — lowest quantity first so the most
  // urgent items are at the top of the page, not buried alphabetically.
  const printItems = showLowStockOnly
    ? [...displayedItems].sort((a, b) => a.quantity - b.quantity)
    : displayedItems;

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

      // Existing items, so re-importing a file (or a sheet with repeated barcodes/names)
      // updates the matching item instead of failing on the barcode UNIQUE constraint.
      const existingByBarcode = new Map(items.filter((i) => i.barcode).map((i) => [i.barcode!.toLowerCase(), i]));
      const existingByName = new Map(items.map((i) => [i.name.trim().toLowerCase(), i]));

      let created = 0;
      let updated = 0;
      let skipped = 0;
      const errorCounts = new Map<string, number>();

      let stockChanged = 0;
      const json = { 'Content-Type': 'application/json' };
      const num = (v: unknown) => (v === undefined ? undefined : Number(v));

      for (const row of rows) {
        const name = String(field(row, ['Name']) || '').trim();
        if (!name) { skipped++; continue; }
        const barcodeRaw = field(row, ['Barcode']);
        const barcode = barcodeRaw ? String(barcodeRaw).trim() : undefined;
        // Only columns actually present in the sheet are applied — a file without a
        // Quantity or price column must not reset those values to 0 on every item.
        const sheet = {
          barcode,
          name,
          category: field(row, ['Category']) as string | undefined,
          cost_price: num(field(row, ['CostPrice', 'Cost Price', 'BuyPrice', 'Buy Price', 'Cost'])),
          sale_price: num(field(row, ['SalePrice', 'Sale Price', 'SellPrice', 'Sell Price', 'Price'])),
          unit: field(row, ['Unit']) as string | undefined,
          unit_type: field(row, ['UnitType', 'Unit Type']) === undefined ? undefined : field(row, ['UnitType', 'Unit Type']) === 'WEIGHT' ? 'WEIGHT' : 'COUNT',
          low_stock_threshold: num(field(row, ['LowStockThreshold', 'Low Stock Threshold', 'Low Stock Alert'])),
        };
        const sheetQty = num(field(row, ['Quantity', 'Stock', 'Qty']));

        const existing = (barcode && existingByBarcode.get(barcode.toLowerCase())) || existingByName.get(name.toLowerCase());
        let res: Response;
        if (existing) {
          res = await fetch('/api/items', { method: 'PUT', headers: json, body: JSON.stringify({ id: existing.id, ...sheet, _import: true }) });
          // A different quantity in the sheet is applied as a recorded stock count.
          if (res.ok && sheetQty !== undefined && Number.isFinite(sheetQty) && sheetQty !== existing.quantity) {
            const adj = await fetch('/api/items/adjust', {
              method: 'POST', headers: json,
              body: JSON.stringify({ id: existing.id, mode: 'SET', quantity: sheetQty, reason: 'Excel import', notes: file.name, _import: true }),
            });
            if (adj.ok) { res = adj; stockChanged++; }
          }
        } else {
          res = await fetch('/api/items', {
            method: 'POST', headers: json,
            body: JSON.stringify({
              ...sheet, category: sheet.category || 'General', cost_price: sheet.cost_price ?? 0, sale_price: sheet.sale_price ?? 0,
              quantity: sheetQty ?? 0, unit: sheet.unit || 'Pcs', unit_type: sheet.unit_type || 'COUNT',
              low_stock_threshold: sheet.low_stock_threshold ?? 5, _import: true,
            }),
          });
        }

        if (res.ok) {
          const saved: Item = await res.json();
          if (saved.barcode) existingByBarcode.set(saved.barcode.toLowerCase(), saved);
          existingByName.set(saved.name.toLowerCase(), saved);
          if (existing) updated++; else created++;
        } else {
          const body = await res.json().catch(() => ({}));
          const message = body.error || `HTTP ${res.status}`;
          errorCounts.set(message, (errorCounts.get(message) || 0) + 1);
          skipped++;
        }
      }

      const parts = [`${created} added`, `${updated} updated`, `${stockChanged} stock count(s) changed`];
      if (skipped) parts.push(`${skipped} skipped`);
      setImportSummary(`Imported ${rows.length} row(s): ${parts.join(', ')}.`);
      if (errorCounts.size) {
        const reasons = Array.from(errorCounts.entries()).map(([msg, n]) => `${msg} (×${n})`).join('; ');
        setImportError(`Some rows were skipped — ${reasons}`);
      }
      load(search);
    } catch {
      setImportError('Could not read the Excel file. Expected columns include Name, Category, Cost/Buy Price, Sale/Sell Price, Quantity/Stock, Unit, Barcode.');
    }
  };

  return (
    <div className="p-6">
      {/* Print-only stock/low-stock list */}
      <div className="print-only p-4">
        <h1 className="text-xl font-bold">{shop.shopName}</h1>
        <p className="text-sm font-semibold mt-1">{showLowStockOnly ? 'Low Stock List' : 'Stock List'}{search.trim() ? ` — matching "${search.trim()}"` : ''}</p>
        <p className="text-xs text-slate-500" suppressHydrationWarning>{new Date().toLocaleString()} · {printItems.length} item{printItems.length !== 1 ? 's' : ''}</p>
        <table className="w-full mt-3 text-sm">
          <thead>
            <tr className="border-b border-black text-left">
              <th className="py-1 pr-2">Name</th>
              <th className="py-1 pr-2">Category</th>
              <th className="py-1 pr-2">Barcode</th>
              <th className="py-1 pr-2 text-right">Cost</th>
              <th className="py-1 pr-2 text-right">Sale</th>
              <th className="py-1 pr-2 text-right">Qty</th>
              <th className="py-1">Unit</th>
            </tr>
          </thead>
          <tbody>
            {printItems.map((item) => (
              <tr key={item.id} className="border-b border-slate-300">
                <td className="py-1 pr-2">{item.name}</td>
                <td className="py-1 pr-2">{item.category}</td>
                <td className="py-1 pr-2">{item.barcode || '—'}</td>
                <td className="py-1 pr-2 text-right">{formatCurrency(item.cost_price)}</td>
                <td className="py-1 pr-2 text-right">{formatCurrency(item.sale_price)}</td>
                <td className="py-1 pr-2 text-right font-bold">{item.quantity}</td>
                <td className="py-1">{item.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="no-print flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Stock & Inventory</h1>
          <p className="text-slate-500 text-sm mt-0.5">{items.length} items total</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/stock/manage" className="flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2.5 rounded-xl font-semibold transition-colors">
            <SlidersHorizontal size={16} /> Manage Stock
          </Link>
          <button onClick={findDuplicates} className="flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2.5 rounded-xl font-semibold transition-colors">
            <Copy size={16} /> Duplicates
          </button>
          <button onClick={() => window.print()} className="flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2.5 rounded-xl font-semibold transition-colors">
            <Printer size={16} /> Print
          </button>
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

      <div className="no-print">
        {notice && (
          <div className="mb-4 flex items-start justify-between gap-3 bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-xl text-sm font-medium">
            <span>{notice}</span>
            <button onClick={() => setNotice('')} className="text-blue-400 hover:text-blue-600"><X size={16} /></button>
          </div>
        )}
        {duplicates && (
          <div className="mb-4 bg-white border border-slate-200 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-slate-700">Duplicate items</h2>
              <button onClick={() => setDuplicates(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            {duplicates.length === 0 ? (
              <p className="text-sm text-slate-500">No duplicates found. Items only count as duplicates when their names match ignoring capitals, spaces and punctuation. To join two items with different names, open one in Manage Stock and use Merge.</p>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-slate-500">Click <b>Keep this</b> on the item you want to keep. The others merge into it: their sales history moves over and their stock is added.</p>
                {duplicates.map((group) => (
                  <div key={group[0].id} className="border border-amber-200 bg-amber-50/50 rounded-xl divide-y divide-amber-100">
                    {group.map((g) => (
                      <div key={g.id} className="flex items-center justify-between px-3 py-2 text-sm">
                        <span><span className="font-mono text-slate-400 mr-2">#{g.id}</span><b>{g.name}</b> <span className="text-slate-500">· stock {g.quantity} · {formatCurrency(g.sale_price)}{g.barcode ? ` · ${g.barcode}` : ''}</span></span>
                        <button disabled={merging} onClick={() => mergeGroup(g, group)} className="text-xs font-bold bg-amber-500 hover:bg-amber-600 disabled:bg-slate-300 text-white px-3 py-1.5 rounded-lg">Keep this</button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
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
                        <Link href={`/stock/manage?id=${item.id}`} title="Manage stock & history" className="text-slate-400 hover:text-emerald-600 transition-colors"><SlidersHorizontal size={15} /></Link>
                        <button onClick={() => openEdit(item)} title="Edit details" className="text-slate-400 hover:text-blue-600 transition-colors"><Edit2 size={15} /></button>
                        <button onClick={() => del(item)} title="Delete" className="text-slate-400 hover:text-red-600 transition-colors"><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="no-print fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
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
              {editItem ? (
                <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                  <div>
                    <p className="text-xs font-semibold text-slate-500">Current stock</p>
                    <p className="text-lg font-black text-slate-800">{editItem.quantity} {editItem.unit}</p>
                  </div>
                  <Link href={`/stock/manage?id=${editItem.id}`} className="text-sm font-semibold text-emerald-600 hover:text-emerald-700">Add / correct stock →</Link>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Opening Quantity {form.unitType === 'WEIGHT' ? '(supports decimals, e.g. 2.5)' : ''}</label>
                  <input type="number" step={form.unitType === 'WEIGHT' ? '0.01' : '1'} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              )}
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
