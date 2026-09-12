'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Trash2, Printer, RotateCcw, UserPlus, CreditCard, Banknote, Wallet,
  Search, Barcode as BarcodeIcon, Plus, Minus, PauseCircle, ListRestart, X, PackagePlus, CheckCircle2,
} from 'lucide-react';
import { useBillingStore } from '@/store/useBillingStore';
import { formatCurrency, cn } from '@/lib/utils';

interface Item {
  id: number;
  barcode: string | null;
  name: string;
  sale_price: number;
  quantity: number;
  category: string;
  unit: string;
  unit_type: 'COUNT' | 'WEIGHT';
}

interface Customer {
  id: number;
  name: string;
  phone: string;
  balance: number;
}

const TILE_COLORS = [
  'bg-blue-50 border-blue-200 text-blue-700',
  'bg-emerald-50 border-emerald-200 text-emerald-700',
  'bg-amber-50 border-amber-200 text-amber-700',
  'bg-violet-50 border-violet-200 text-violet-700',
  'bg-rose-50 border-rose-200 text-rose-700',
  'bg-cyan-50 border-cyan-200 text-cyan-700',
  'bg-orange-50 border-orange-200 text-orange-700',
  'bg-teal-50 border-teal-200 text-teal-700',
];

function categoryColor(category: string) {
  let hash = 0;
  for (let i = 0; i < category.length; i++) hash = (hash * 31 + category.charCodeAt(i)) >>> 0;
  return TILE_COLORS[hash % TILE_COLORS.length];
}

const CART_WIDTH_KEY = 'hp_billing_cart_width';
const DEFAULT_CART_WIDTH = 400;
const MIN_CART_WIDTH = 280;
const MIN_CATALOG_WIDTH = 320;

export default function BillingPage() {
  const searchRef = useRef<HTMLInputElement>(null);
  const discountRef = useRef<HTMLInputElement>(null);
  const customerSearchRef = useRef<HTMLInputElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);
  const nameInputRefs = useRef(new Map<string, HTMLInputElement>());
  const priceInputRefs = useRef(new Map<string, HTMLInputElement>());
  const costInputRefs = useRef(new Map<string, HTMLInputElement>());
  const qtyInputRefs = useRef(new Map<string, HTMLInputElement>());

  const [cartWidth, setCartWidth] = useState(DEFAULT_CART_WIDTH);
  const [isDragging, setIsDragging] = useState(false);

  const [allItems, setAllItems] = useState<Item[]>([]);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');

  const [customerSearch, setCustomerSearch] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerSuggestions, setCustomerSuggestions] = useState<Customer[]>([]);

  const [shop, setShop] = useState({ shopName: 'Mart POS', address: '', phone: '', receiptFooter: '' });
  const [showHeld, setShowHeld] = useState(false);
  const [tenderedTouched, setTenderedTouched] = useState(false);

  const {
    cart, discount, paymentType, selectedCustomer, heldBills, cashTendered,
    addItem, removeItem, incrementQty, updateQty, updatePrice, updateCost, updateName, setDiscount,
    setPaymentType, setCustomer, setCashTendered, clearCart, holdCurrent, resumeHeld, removeHeld,
    subtotal, grandTotal, changeDue,
  } = useBillingStore();

  const [processing, setProcessing] = useState(false);
  const [lastBill, setLastBill] = useState<string | null>(null);
  const [lastPaymentSummary, setLastPaymentSummary] = useState<{ paymentType: string; tendered: number; change: number } | null>(null);
  const [error, setError] = useState('');
  const total = grandTotal();

  const loadItems = useCallback(async () => {
    const res = await fetch('/api/items?q=');
    setAllItems(res.ok ? await res.json() : []);
  }, []);

  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then((s) => setShop({
      shopName: s.shopName || 'Mart POS', address: s.address || '', phone: s.phone || '', receiptFooter: s.receiptFooter || '',
    }));
    loadItems();
  }, [loadItems]);

  // ── Resizable cart/catalog split ─────────────────────────────────────────
  useEffect(() => {
    const stored = Number(localStorage.getItem(CART_WIDTH_KEY));
    if (stored) setCartWidth(stored);
  }, []);

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    dragState.current = { startX: e.clientX, startWidth: cartWidth };
    setIsDragging(true);
  };

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      if (!dragState.current) return;
      const containerWidth = splitRef.current?.clientWidth ?? window.innerWidth;
      const maxCartWidth = Math.max(MIN_CART_WIDTH, containerWidth - MIN_CATALOG_WIDTH);
      const delta = dragState.current.startX - e.clientX;
      const next = Math.min(maxCartWidth, Math.max(MIN_CART_WIDTH, dragState.current.startWidth + delta));
      setCartWidth(next);
    };
    const onUp = () => {
      setIsDragging(false);
      dragState.current = null;
      setCartWidth((w) => { localStorage.setItem(CART_WIDTH_KEY, String(w)); return w; });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDragging]);

  const resetSplit = () => {
    setCartWidth(DEFAULT_CART_WIDTH);
    localStorage.setItem(CART_WIDTH_KEY, String(DEFAULT_CART_WIDTH));
  };

  const categories = useMemo(() => {
    const set = new Set(allItems.map((i) => i.category || 'General'));
    return ['All', ...Array.from(set).sort()];
  }, [allItems]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allItems.filter((i) => {
      const matchesCategory = activeCategory === 'All' || i.category === activeCategory;
      const matchesSearch = !q || i.name.toLowerCase().includes(q) || (i.barcode || '').includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [allItems, search, activeCategory]);

  // Keyboard-driven type-ahead dropdown (searches across all categories, independent of the grid filter)
  const searchMatches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return allItems
      .filter((i) => i.name.toLowerCase().includes(q) || (i.barcode || '').includes(q))
      .slice(0, 30);
  }, [allItems, search]);

  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHighlightedIndex(0);
    setShowDropdown(searchMatches.length > 0);
  }, [searchMatches]);

  useEffect(() => {
    const el = dropdownRef.current?.children[highlightedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex]);

  // ── Customer search ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!customerSearch.trim()) { setCustomerSuggestions([]); return; }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/customers?q=${encodeURIComponent(customerSearch)}`);
      setCustomerSuggestions(await res.json());
    }, 200);
    return () => clearTimeout(t);
  }, [customerSearch]);

  // ── Cash tendered: defaults to the exact total until the cashier types a real amount ──
  useEffect(() => {
    if (paymentType === 'CASH' && !tenderedTouched) setCashTendered(total);
  }, [paymentType, total, tenderedTouched, setCashTendered]);

  const selectPaymentType = (type: 'CASH' | 'CARD' | 'UDHAAR') => {
    setPaymentType(type);
    setTenderedTouched(false);
  };

  const addFromCatalog = (item: Item) => {
    addItem({
      itemId: item.id,
      name: item.name,
      quantity: item.unit_type === 'WEIGHT' ? 0.5 : 1,
      price: item.sale_price,
    });
    setPendingFocusItemId(item.id);
  };

  // ── Checkout ─────────────────────────────────────────────────────────────
  const handleCheckout = useCallback(async (print: boolean, type?: 'CASH' | 'CARD' | 'UDHAAR', tenderedOverride?: number) => {
    if (cart.length === 0 || processing) return;
    const effectiveType = type || paymentType;
    const effectiveTendered = tenderedOverride ?? cashTendered;
    if (effectiveType === 'UDHAAR' && !selectedCustomer) {
      setError('Please select a customer for Udhaar payment.');
      return;
    }
    if (effectiveType === 'CASH' && effectiveTendered < total) {
      setError(`Cash tendered (${formatCurrency(effectiveTendered)}) is less than the total (${formatCurrency(total)}).`);
      return;
    }
    setProcessing(true);
    setError('');
    try {
      const res = await fetch('/api/bills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.map((c) => ({
            itemId: c.itemId, name: c.name, quantity: c.quantity, price: c.price, total: c.total,
            // Only custom items carry an explicit cost override — catalog items keep pulling
            // their cost from the item record so historical reports stay consistent.
            costPrice: c.itemId === null ? c.cost : undefined,
          })),
          discount,
          paymentType: effectiveType,
          customerId: selectedCustomer?.id || null,
          customerName: selectedCustomer?.name || 'Walk-in Customer',
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Checkout failed');
        return;
      }
      const bill = await res.json();
      setLastBill(bill.bill_number);
      setLastPaymentSummary({
        paymentType: effectiveType,
        tendered: effectiveTendered,
        change: effectiveType === 'CASH' ? Math.max(0, effectiveTendered - total) : 0,
      });
      if (print) window.print();
      clearCart();
      setTenderedTouched(false);
      loadItems();
      searchRef.current?.focus();
    } finally {
      setProcessing(false);
    }
  }, [cart, discount, paymentType, selectedCustomer, cashTendered, total, processing, clearCart, loadItems]);

  // ── Keyboard-driven search: type a letter, arrow through matches, Enter to add ──
  const selectMatch = (item: Item) => {
    addFromCatalog(item);
    setSearch('');
    setShowDropdown(false);
    // Focus moves to the new row's quantity field instead (see pendingFocusItemId effect).
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (searchMatches.length === 0) return;
      setShowDropdown(true);
      setHighlightedIndex((i) => Math.min(i + 1, searchMatches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (searchMatches.length === 0) return;
      setShowDropdown(true);
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (showDropdown && searchMatches[highlightedIndex]) {
        selectMatch(searchMatches[highlightedIndex]);
      } else if (searchMatches.length === 1) {
        selectMatch(searchMatches[0]);
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  };

  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [pendingFocusItemId, setPendingFocusItemId] = useState<number | null>(null);

  // Runs after React commits the new cart row, so the ref is guaranteed to exist —
  // unlike requestAnimationFrame right after the state update, which isn't reliably
  // ordered after the commit when triggered from a native (non-React) key handler.
  useEffect(() => {
    if (!pendingFocusId) return;
    const el = nameInputRefs.current.get(pendingFocusId);
    el?.focus();
    el?.select();
    setPendingFocusId(null);
  }, [pendingFocusId]);

  // Catalog items: scanning/selecting the same item twice merges into its existing
  // row (see addItem in the store), so the row to focus has to be looked up by
  // itemId rather than a freshly-generated id.
  useEffect(() => {
    if (pendingFocusItemId === null) return;
    const row = cart.find((c) => c.itemId === pendingFocusItemId);
    if (row) {
      const el = qtyInputRefs.current.get(row.id);
      el?.focus();
      el?.select();
    }
    setPendingFocusItemId(null);
  }, [pendingFocusItemId, cart]);

  const addCustomItem = useCallback(() => {
    const id = `custom-${Date.now()}-${Math.random()}`;
    addItem({ id, itemId: null, name: '', quantity: 1, price: 0 });
    setPendingFocusId(id);
  }, [addItem]);

  const focusAndSelect = (map: { current: Map<string, HTMLInputElement> }, id: string) => {
    const el = map.current.get(id);
    el?.focus();
    el?.select();
  };

  const holdBill = useCallback(() => {
    if (cart.length === 0) return;
    const label = selectedCustomer?.name || `Sale ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    holdCurrent(label);
    setTenderedTouched(false);
  }, [cart, selectedCustomer, holdCurrent]);

  // ── Global keyboard shortcuts (F1–F8, matching the till's function-key layout) ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typingInField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName || '');

      if (e.key === 'F1') { e.preventDefault(); selectPaymentType('CASH'); }
      else if (e.key === 'F2') { e.preventDefault(); selectPaymentType('CARD'); }
      else if (e.key === 'F3') { e.preventDefault(); selectPaymentType('UDHAAR'); }
      else if (e.key === 'F4') { e.preventDefault(); holdBill(); }
      else if (e.key === 'F5') { e.preventDefault(); setShowHeld(true); }
      else if (e.key === 'F6') { e.preventDefault(); customerSearchRef.current?.focus(); }
      else if (e.key === 'F7') { e.preventDefault(); discountRef.current?.focus(); discountRef.current?.select(); }
      else if (e.key === 'F8') { e.preventDefault(); if (cart.length > 0 && confirm('Void the entire current order?')) { clearCart(); setTenderedTouched(false); } }
      else if (e.key === 'F9') { e.preventDefault(); handleCheckout(true); }
      else if (e.key === 'F10') { e.preventDefault(); handleCheckout(false); }
      else if (e.altKey && e.key.toLowerCase() === 'c') { e.preventDefault(); addCustomItem(); }
      else if ((e.key === '/' || e.key === ' ') && !typingInField) { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === 'Escape') { setShowDropdown(false); setShowHeld(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleCheckout, addCustomItem, holdBill, cart, clearCart]);

  // ── New customer ────────────────────────────────────────────────────────────
  const createCustomer = async () => {
    const name = customerSearch.trim();
    if (!name) return;
    const res = await fetch('/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone: customerPhone.trim() }),
    });
    const c = await res.json();
    setCustomer(c);
    setCustomerSearch(c.name);
    setCustomerPhone('');
    setCustomerSuggestions([]);
  };

  return (
    <>
      {/* ── PRINT INVOICE (hidden except print) ───────────────────── */}
      <div className="print-only p-8 font-mono text-sm">
        <div className="text-center mb-4">
          <h1 className="text-xl font-bold">{shop.shopName}</h1>
          {shop.address && <p>{shop.address}</p>}
          {shop.phone && <p>{shop.phone}</p>}
          <p className="mt-1 font-bold">SALES RECEIPT</p>
          {lastBill && <p>Bill #: {lastBill}</p>}
          <p suppressHydrationWarning>{new Date().toLocaleString()}</p>
        </div>
        <table className="w-full">
          <thead><tr className="border-b border-dashed border-black"><th className="text-left">Item</th><th className="text-center">Qty</th><th className="text-right">Price</th><th className="text-right">Total</th></tr></thead>
          <tbody>
            {cart.map((i) => (
              <tr key={i.id}><td>{i.name}</td><td className="text-center">{i.quantity}</td><td className="text-right">{i.price}</td><td className="text-right">{i.total}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-dashed border-black mt-2 pt-2 text-right">
          <p>Subtotal: {formatCurrency(subtotal())}</p>
          {discount > 0 && <p>Discount: - {formatCurrency(discount)}</p>}
          <p className="text-lg font-bold">Total: {formatCurrency(grandTotal())}</p>
          <p>Payment: {lastPaymentSummary?.paymentType || paymentType}</p>
          {lastPaymentSummary?.paymentType === 'CASH' && (
            <>
              <p>Tendered: {formatCurrency(lastPaymentSummary.tendered)}</p>
              <p>Change: {formatCurrency(lastPaymentSummary.change)}</p>
            </>
          )}
        </div>
        <p className="text-center mt-6 text-xs">{shop.receiptFooter || 'Thank you for shopping with us!'}</p>
      </div>

      {/* ── MAIN UI ───────────────────────────────────────────────── */}
      <div
        ref={splitRef}
        className={cn('no-print flex h-[calc(100vh-49px)] gap-0 bg-slate-50', isDragging && 'select-none cursor-col-resize')}
      >

        {/* LEFT: CATALOG */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3">
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-slate-800">Point of Sale</h1>
              <p className="text-xs text-slate-400 mt-0.5">Type to search, ↑↓ to pick, Enter to add — or tap a product below</p>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <div className="hidden 2xl:flex items-center gap-1.5 text-[11px] text-slate-400">
                <kbd className="px-1.5 py-1 bg-white border border-slate-200 rounded-md">Space</kbd>search
                <kbd className="px-1.5 py-1 bg-white border border-slate-200 rounded-md">F1-F3</kbd>pay
                <kbd className="px-1.5 py-1 bg-white border border-slate-200 rounded-md">F9</kbd>checkout
                <kbd className="px-1.5 py-1 bg-white border border-slate-200 rounded-md">F10</kbd>checkout only
                <kbd className="px-1.5 py-1 bg-white border border-slate-200 rounded-md">F7</kbd>discount
                <kbd className="px-1.5 py-1 bg-white border border-slate-200 rounded-md">F8</kbd>void
                <kbd className="px-1.5 py-1 bg-white border border-slate-200 rounded-md">Alt+C</kbd>custom
              </div>
              <button
                onClick={() => setShowHeld(true)}
                className="relative flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 bg-white border border-slate-200 px-3 py-2 rounded-xl transition-colors whitespace-nowrap"
              >
                <PauseCircle size={15} /> Held Bills
                <kbd className="ml-0.5 px-1 py-0.5 bg-slate-100 border border-slate-200 rounded text-[10px] font-bold text-slate-400">F5</kbd>
                {heldBills.length > 0 && (
                  <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-amber-500 text-white text-[11px] font-bold flex items-center justify-center">{heldBills.length}</span>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="mx-6 mb-3 bg-red-50 border border-red-200 text-red-700 px-4 py-2.5 rounded-xl text-sm font-medium">{error}</div>
          )}

          {/* Search bar with keyboard-navigable dropdown */}
          <div className="px-6 pb-3 relative">
            <div className="relative">
              <BarcodeIcon size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                ref={searchRef}
                autoFocus
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                onFocus={() => searchMatches.length > 0 && setShowDropdown(true)}
                onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                placeholder="Scan barcode or search products... (press Space to focus)"
                className="w-full h-12 pl-11 pr-4 bg-white border border-slate-200 rounded-xl text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {showDropdown && searchMatches.length > 0 && (
              <div ref={dropdownRef} className="absolute left-6 right-6 top-full mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-xl max-h-96 overflow-y-auto overscroll-contain">
                {searchMatches.map((item, idx) => (
                  <button
                    key={item.id}
                    onMouseDown={() => selectMatch(item)}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                    className={`w-full flex items-center justify-between px-4 py-2.5 text-left border-b border-slate-100 last:border-0 transition-colors ${
                      idx === highlightedIndex ? 'bg-blue-50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border flex-shrink-0 ${categoryColor(item.category)}`}>{item.category}</span>
                      <span className="font-medium text-sm truncate">{item.name}</span>
                      <span className="text-xs text-slate-400 flex-shrink-0">Stock: {item.quantity} {item.unit}</span>
                    </div>
                    <span className="font-bold text-blue-600 flex-shrink-0 ml-3">{formatCurrency(item.sale_price)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Current Sale — the running list of what's actually been added, front and center */}
          <div className="px-6 pb-3">
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-700">Current Sale</h2>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400">{cart.length} item{cart.length !== 1 ? 's' : ''}</span>
                  {cart.length > 0 && (
                    <button onClick={clearCart} title="Clear bill" className="text-slate-400 hover:text-red-500 transition-colors">
                      <ListRestart size={15} />
                    </button>
                  )}
                </div>
              </div>
              {cart.length === 0 ? (
                <div className="py-6 px-4 text-center text-slate-300 text-sm">
                  Nothing added yet. Scan or tap a product to start this sale.
                </div>
              ) : (
                <div className="max-h-[34vh] overflow-y-auto divide-y divide-slate-100">
                  {cart.map((item) => (
                    <div key={item.id} className="px-4 py-2.5 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        {item.itemId === null ? (
                          <input
                            ref={(el) => { if (el) nameInputRefs.current.set(item.id, el); else nameInputRefs.current.delete(item.id); }}
                            type="text"
                            value={item.name}
                            onChange={(e) => updateName(item.id, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); focusAndSelect(priceInputRefs, item.id); }
                            }}
                            className="w-full h-7 bg-slate-50 border border-slate-300 rounded-lg text-sm px-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-800"
                            placeholder="Custom item name..."
                          />
                        ) : (
                          <p className="text-sm font-semibold text-slate-800 truncate">{item.name}</p>
                        )}
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          <span className="text-[11px] text-slate-400">Sale Rs.</span>
                          <input
                            ref={(el) => { if (el) priceInputRefs.current.set(item.id, el); else priceInputRefs.current.delete(item.id); }}
                            type="number"
                            min="0"
                            value={item.price}
                            onChange={(e) => updatePrice(item.id, Number(e.target.value))}
                            onFocus={(e) => e.target.select()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                focusAndSelect(item.itemId === null ? costInputRefs : qtyInputRefs, item.id);
                              }
                            }}
                            className="w-16 h-6 bg-slate-50 border border-slate-200 rounded text-xs px-1.5 text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                          {item.itemId === null && (
                            <>
                              <span className="text-[11px] text-amber-600">Cost Rs.</span>
                              <input
                                ref={(el) => { if (el) costInputRefs.current.set(item.id, el); else costInputRefs.current.delete(item.id); }}
                                type="number"
                                min="0"
                                value={item.cost}
                                onChange={(e) => updateCost(item.id, Number(e.target.value))}
                                onFocus={(e) => e.target.select()}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') { e.preventDefault(); focusAndSelect(qtyInputRefs, item.id); }
                                }}
                                title="What this item cost you — used for profit reports"
                                className="w-16 h-6 bg-amber-50 border border-amber-300 rounded text-xs px-1.5 text-amber-700 focus:outline-none focus:ring-1 focus:ring-amber-500"
                              />
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg px-1 py-1">
                        <button onClick={() => incrementQty(item.id, -1)} className="w-7 h-7 flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-slate-200 rounded-md"><Minus size={14} /></button>
                        <input
                          ref={(el) => { if (el) qtyInputRefs.current.set(item.id, el); else qtyInputRefs.current.delete(item.id); }}
                          type="number"
                          min="0"
                          value={item.quantity}
                          onChange={(e) => updateQty(item.id, Number(e.target.value))}
                          onFocus={(e) => e.target.select()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); searchRef.current?.focus(); }
                          }}
                          className="w-10 h-7 text-center text-sm font-bold bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-500 rounded text-slate-800"
                        />
                        <button onClick={() => incrementQty(item.id, 1)} className="w-7 h-7 flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-slate-200 rounded-md"><Plus size={14} /></button>
                      </div>
                      <div className="w-20 text-right font-bold text-sm text-slate-800">{formatCurrency(item.total)}</div>
                      <button onClick={() => removeItem(item.id)} className="text-slate-300 hover:text-red-500 transition-colors">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Category tabs */}
          <div className="px-6 pb-3 flex gap-2 overflow-x-auto">
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setActiveCategory(c)}
                className={`whitespace-nowrap px-4 py-2 rounded-full text-xs font-bold transition-colors border ${
                  activeCategory === c ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          {/* Product grid — only browse the full catalog once the cashier searches or picks a category */}
          <div className="flex-1 overflow-y-auto px-6 pb-6">
            {!search.trim() && activeCategory === 'All' ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-300 gap-3">
                <BarcodeIcon size={40} />
                <p className="text-sm">Scan a barcode, type to search, or pick a category above to browse products</p>
                <button
                  onClick={addCustomItem}
                  className="flex items-center gap-1.5 text-xs font-semibold text-blue-500 hover:text-blue-600 transition-colors"
                >
                  <PackagePlus size={14} /> Add a custom item instead
                </button>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-300 gap-3">
                <Search size={40} />
                <p className="text-sm">No products match — try another search or category</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {filteredItems.map((item) => {
                  const outOfStock = item.quantity <= 0;
                  return (
                    <button
                      key={item.id}
                      onClick={() => addFromCatalog(item)}
                      className="group text-left bg-white border border-slate-200 rounded-2xl p-3.5 hover:shadow-md hover:-translate-y-0.5 hover:border-blue-300 transition-all flex flex-col gap-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${categoryColor(item.category)}`}>{item.category}</span>
                        {outOfStock ? (
                          <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-600">Out</span>
                        ) : item.quantity <= 5 ? (
                          <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">{item.quantity} left</span>
                        ) : null}
                      </div>
                      <p className="font-semibold text-sm text-slate-800 leading-snug line-clamp-2 min-h-[2.5rem]">{item.name}</p>
                      <div className="flex items-end justify-between mt-auto">
                        <span className="font-black text-blue-600 text-lg">{formatCurrency(item.sale_price)}</span>
                        <span className="text-[11px] text-slate-400">/ {item.unit}</span>
                      </div>
                    </button>
                  );
                })}
                <button
                  onClick={addCustomItem}
                  className="flex flex-col items-center justify-center gap-1.5 border-2 border-dashed border-slate-200 rounded-2xl p-3.5 text-slate-400 hover:border-blue-300 hover:text-blue-500 transition-colors min-h-[112px]"
                >
                  <PackagePlus size={20} />
                  <span className="text-xs font-semibold">Custom Item</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Drag handle */}
        <div
          onMouseDown={startDrag}
          onDoubleClick={resetSplit}
          title="Drag to resize · double-click to reset"
          className="w-1.5 flex-shrink-0 bg-slate-200 hover:bg-blue-400 active:bg-blue-500 cursor-col-resize transition-colors relative group"
        >
          <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
        </div>

        {/* RIGHT: CHECKOUT */}
        <div style={{ width: cartWidth }} className="flex-shrink-0 bg-slate-900 text-white flex flex-col overflow-y-auto">
          <div className="p-5 border-b border-slate-700">
            <h2 className="text-lg font-bold">Checkout</h2>
            <p className="text-slate-400 text-xs mt-0.5">{cart.length} item{cart.length !== 1 ? 's' : ''} · {formatCurrency(subtotal())}</p>
          </div>

          {/* Payment Type */}
          <div className="p-4 border-t border-slate-700">
            <p className="text-xs font-semibold text-slate-400 mb-2 uppercase">Payment Type</p>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => selectPaymentType('CASH')}
                className={`relative flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl text-xs font-semibold transition-all ${paymentType === 'CASH' ? 'bg-green-500 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
              >
                <kbd className={`absolute top-1 right-1.5 text-[9px] font-bold ${paymentType === 'CASH' ? 'text-white/70' : 'text-slate-500'}`}>F1</kbd>
                <Banknote size={16} /> Cash
              </button>
              <button
                onClick={() => selectPaymentType('CARD')}
                className={`relative flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl text-xs font-semibold transition-all ${paymentType === 'CARD' ? 'bg-blue-500 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
              >
                <kbd className={`absolute top-1 right-1.5 text-[9px] font-bold ${paymentType === 'CARD' ? 'text-white/70' : 'text-slate-500'}`}>F2</kbd>
                <Wallet size={16} /> Card
              </button>
              <button
                onClick={() => selectPaymentType('UDHAAR')}
                className={`relative flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl text-xs font-semibold transition-all ${paymentType === 'UDHAAR' ? 'bg-orange-500 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
              >
                <kbd className={`absolute top-1 right-1.5 text-[9px] font-bold ${paymentType === 'UDHAAR' ? 'text-white/70' : 'text-slate-500'}`}>F3</kbd>
                <CreditCard size={16} /> Udhaar
              </button>
            </div>
          </div>

          {/* Cash Tendered (Cash mode) */}
          {paymentType === 'CASH' && (
            <div className="p-4 border-t border-slate-700">
              <p className="text-xs font-semibold text-slate-400 mb-2 uppercase">Cash Tendered</p>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-slate-500 text-sm">Rs.</span>
                <input
                  type="number"
                  min="0"
                  value={cashTendered}
                  onChange={(e) => { setTenderedTouched(true); setCashTendered(Number(e.target.value)); }}
                  className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-base font-bold focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {[100, 500, 1000, 5000].map((n) => (
                  <button
                    key={n}
                    onClick={() => { setTenderedTouched(true); setCashTendered(n); }}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-semibold text-slate-300 transition-colors"
                  >
                    Rs.{n}
                  </button>
                ))}
                <button
                  onClick={() => { setTenderedTouched(false); setCashTendered(total); }}
                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-semibold text-slate-300 transition-colors"
                >
                  Exact
                </button>
              </div>
            </div>
          )}

          {/* Customer — always available, regardless of payment type. Required only for Udhaar. */}
          <div className="p-4 border-t border-slate-700">
            <p className="text-xs font-semibold text-slate-400 mb-2 uppercase">
              Customer {paymentType !== 'UDHAAR' && <span className="normal-case font-normal text-slate-500">(optional — defaults to Walk-in)</span>}
            </p>
            {selectedCustomer ? (
              <div className="bg-slate-800 rounded-xl p-3 flex justify-between items-center">
                <div>
                  <p className="font-semibold">{selectedCustomer.name}</p>
                  {selectedCustomer.phone && <p className="text-xs text-slate-400">{selectedCustomer.phone}</p>}
                </div>
                <button onClick={() => { setCustomer(null); setCustomerSearch(''); setCustomerPhone(''); }} className="text-slate-400 hover:text-white">✕</button>
              </div>
            ) : (
              <div className="relative space-y-2">
                <input
                  ref={customerSearchRef}
                  type="text"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  placeholder="Customer name... (F6)"
                  className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 text-white placeholder-slate-500"
                />
                {customerSearch && customerSuggestions.length === 0 && (
                  <input
                    type="tel"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="Contact number (optional)"
                    className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 text-white placeholder-slate-500"
                  />
                )}
                {customerSuggestions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-slate-800 border border-slate-600 rounded-xl shadow-xl max-h-40 overflow-y-auto">
                    {customerSuggestions.map((c) => (
                      <button
                        key={c.id}
                        onMouseDown={() => { setCustomer(c); setCustomerSearch(c.name); setCustomerSuggestions([]); }}
                        className="w-full text-left px-4 py-2.5 hover:bg-slate-700 border-b border-slate-700 last:border-0"
                      >
                        <p className="font-semibold text-sm">{c.name}</p>
                        <p className="text-xs text-orange-400">Balance: {formatCurrency(c.balance)}</p>
                      </button>
                    ))}
                  </div>
                )}
                {customerSearch && customerSuggestions.length === 0 && (
                  <button
                    onMouseDown={createCustomer}
                    className="w-full flex items-center gap-2 text-sm text-green-400 hover:text-green-300"
                  >
                    <UserPlus size={14} /> Save "{customerSearch}" as new customer
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Totals */}
          <div className="p-5 flex flex-col gap-2.5 border-t border-slate-700">
            <div className="flex justify-between text-slate-400 text-sm">
              <span>Subtotal</span>
              <span className="text-white font-medium">{formatCurrency(subtotal())}</span>
            </div>
            <div className="flex justify-between items-center text-slate-400 text-sm">
              <span className="flex items-center gap-1.5">Discount <kbd className="px-1 py-0.5 bg-slate-800 border border-slate-700 rounded text-[9px] font-bold text-slate-500">F7</kbd></span>
              <div className="flex items-center gap-1">
                <span className="text-slate-500">Rs.</span>
                <input
                  ref={discountRef}
                  type="number"
                  min="0"
                  value={discount}
                  onChange={(e) => setDiscount(Number(e.target.value))}
                  className="w-24 bg-slate-800 border border-slate-600 rounded-lg px-2 py-1 text-right text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex justify-between text-2xl font-black border-t border-slate-700 pt-3 mt-1">
              <span className="text-slate-300 text-base font-semibold self-end pb-1">Grand Total</span>
              <span className="text-green-400">{formatCurrency(total)}</span>
            </div>
            {paymentType === 'CASH' && (
              <div className={`flex justify-between items-center text-sm font-bold px-3 py-2 rounded-lg ${cashTendered < total ? 'bg-red-900/40 text-red-300' : 'bg-emerald-900/40 text-emerald-300'}`}>
                <span>{cashTendered < total ? 'Short By' : 'Change Due'}</span>
                <span>{cashTendered < total ? formatCurrency(total - cashTendered) : formatCurrency(changeDue())}</span>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="p-4 space-y-2 border-t border-slate-700">
            <div className="flex gap-2">
              <button
                onClick={() => handleCheckout(true)}
                disabled={processing || cart.length === 0}
                title="Checkout & Print (F9)"
                className="relative flex-[3] flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-2xl transition-all text-base"
              >
                <Printer size={19} />
                {processing ? 'Processing...' : 'Checkout & Print'}
                <kbd className="absolute top-1.5 right-2 text-[9px] font-bold text-white/60">F9</kbd>
              </button>
              <button
                onClick={() => handleCheckout(false)}
                disabled={processing || cart.length === 0}
                title="Checkout without printing a receipt (F10)"
                className="relative flex-[2] flex items-center justify-center gap-2 bg-emerald-800/60 hover:bg-emerald-800 disabled:bg-slate-700 disabled:cursor-not-allowed text-emerald-100 font-bold py-3.5 rounded-2xl transition-all text-sm"
              >
                <CheckCircle2 size={17} />
                Checkout Only
                <kbd className="absolute top-1.5 right-2 text-[9px] font-bold text-emerald-100/60">F10</kbd>
              </button>
            </div>
            <div className="flex gap-2">
              <button
                onClick={holdBill}
                disabled={cart.length === 0}
                className="flex-1 flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 hover:text-white py-2.5 rounded-xl transition-all text-sm font-semibold"
              >
                <PauseCircle size={16} /> Hold Bill <kbd className="px-1 py-0.5 bg-slate-900 border border-slate-700 rounded text-[9px] font-bold text-slate-500">F4</kbd>
              </button>
              <button
                onClick={() => { if (cart.length > 0 && confirm('Void the entire current order?')) { clearCart(); setTenderedTouched(false); } }}
                disabled={cart.length === 0}
                className="flex-1 flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 hover:text-white py-2.5 rounded-xl transition-all text-sm font-semibold"
              >
                <RotateCcw size={16} /> Void <kbd className="px-1 py-0.5 bg-slate-900 border border-slate-700 rounded text-[9px] font-bold text-slate-500">F8</kbd>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Held bills drawer */}
      {showHeld && (
        <div className="no-print fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-800">Held Bills</h2>
              <button onClick={() => setShowHeld(false)}><X size={20} className="text-slate-400" /></button>
            </div>
            <div className="p-4">
              {heldBills.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">No bills on hold.</p>
              ) : (
                <div className="space-y-2">
                  {heldBills.map((h) => (
                    <div key={h.id} className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm text-slate-800 truncate">{h.label}</p>
                        <p className="text-xs text-slate-400">{h.cart.length} item{h.cart.length !== 1 ? 's' : ''} · {formatCurrency(h.cart.reduce((s, i) => s + i.total, 0))} · {new Date(h.heldAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        <button
                          onClick={() => {
                            if (cart.length > 0 && !confirm('This will replace the items currently in the cart. Continue?')) return;
                            resumeHeld(h.id);
                            setShowHeld(false);
                          }}
                          className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
                        >
                          Resume
                        </button>
                        <button onClick={() => removeHeld(h.id)} className="text-slate-400 hover:text-red-500 transition-colors p-1.5">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
