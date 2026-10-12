const ACTIONS: Record<string, { label: string; cls: string }> = {
  SALE: { label: 'Sold', cls: 'bg-blue-100 text-blue-700' },
  RETURN: { label: 'Returned', cls: 'bg-purple-100 text-purple-700' },
  PURCHASE: { label: 'Stock In (bought)', cls: 'bg-green-100 text-green-700' },
  ADJUST: { label: 'Stock corrected', cls: 'bg-amber-100 text-amber-800' },
  OPENING: { label: 'Opening stock', cls: 'bg-teal-100 text-teal-700' },
  ITEM_CREATE: { label: 'Item added', cls: 'bg-emerald-100 text-emerald-700' },
  ITEM_EDIT: { label: 'Details edited', cls: 'bg-slate-100 text-slate-700' },
  ITEM_DELETE: { label: 'Item deleted', cls: 'bg-red-100 text-red-700' },
  ITEM_ARCHIVE: { label: 'Item removed', cls: 'bg-red-100 text-red-700' },
  ITEM_MERGE: { label: 'Duplicate merged', cls: 'bg-orange-100 text-orange-700' },
  IMPORT: { label: 'Excel import', cls: 'bg-indigo-100 text-indigo-700' },
  EXPENSE: { label: 'Expense added', cls: 'bg-rose-100 text-rose-700' },
  EXPENSE_DELETE: { label: 'Expense deleted', cls: 'bg-rose-100 text-rose-700' },
};

export function actionLabel(action: string) {
  return ACTIONS[action]?.label || action;
}

export function ActionBadge({ action }: { action: string }) {
  const a = ACTIONS[action] || { label: action, cls: 'bg-slate-100 text-slate-600' };
  return <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded-md whitespace-nowrap ${a.cls}`}>{a.label}</span>;
}

/** "+3", "−2", or "—" for entries that don't change stock. */
export function formatQty(n: number | null | undefined) {
  if (n === null || n === undefined || n === 0) return '—';
  const v = Math.round(n * 1000) / 1000;
  return v > 0 ? `+${v}` : `−${Math.abs(v)}`;
}
