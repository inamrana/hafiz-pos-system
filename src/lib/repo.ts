import { currentDb, writeBatch, readBatch, sql, type Statement } from './tenant-context';
import {
  generateBillNumber, generatePurchaseNumber, generateReturnNumber, shopNowParts, shopMidnightUtc,
  SHOP_TZ_SHIFT_SQL, toSqlTimestamp, sqlTimestampOf, shopDayRangeSql,
} from './utils';
import type {
  Item, Customer, CustomerLedgerEntry, Bill, BillItem, Supplier, Purchase, PurchaseItem,
  ActivityAction, ActivityEntry, Expense,
} from './models';

// ── helpers ──────────────────────────────────────────────────────────────────
function nowIso() {
  return new Date().toISOString();
}

/** Name key used to spot duplicates: case, spacing and punctuation don't count ("Gift Bag (L)" == "gift bag l"). */
export function normalizeItemName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export class DuplicateItemError extends Error {
  constructor(public existing: Item) {
    super(`"${existing.name}" already exists in stock (ID ${existing.id})`);
  }
}

function isUniqueViolation(e: unknown, column: string) {
  return e instanceof Error && e.message.includes('UNIQUE') && e.message.includes(column);
}

/**
 * Bill/purchase/return numbers are a random 4-digit suffix per day, which can
 * collide on a busy day. The whole batch is rejected atomically when it does, so
 * simply retry with a fresh number.
 */
async function withFreshNumber<T>(generate: () => string, column: string, attempt: (n: string) => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await attempt(generate());
    } catch (e) {
      if (i < 4 && isUniqueViolation(e, column)) continue;
      throw e;
    }
  }
}

interface LogInput {
  action: ActivityAction;
  itemId?: number | null;
  itemName?: string | null;
  qtyChange?: number | null;
  qtyBefore?: number | null;
  qtyAfter?: number | null;
  amount?: number | null;
  reference?: string;
  reason?: string;
  details?: string;
}

const LOG_COLUMNS = 'action, item_id, item_name, qty_change, qty_before, qty_after, amount, reference, reason, details';

function logStmt(e: LogInput): Statement {
  return sql(
    `INSERT INTO activity_log (${LOG_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    e.action, e.itemId ?? null, e.itemName ?? null, e.qtyChange ?? null, e.qtyBefore ?? null,
    e.qtyAfter ?? null, e.amount ?? null, e.reference || '', e.reason || '', e.details || ''
  );
}

/**
 * Log entry for a quantity change, placed in the batch right AFTER the UPDATE:
 * before/after are read from the row inside the same atomic batch, so they're
 * exact even if a sale lands at the same moment.
 */
function logAfterChangeStmt(itemId: number, delta: number, e: Omit<LogInput, 'itemId' | 'itemName' | 'qtyChange' | 'qtyBefore' | 'qtyAfter'>): Statement {
  return sql(
    `INSERT INTO activity_log (${LOG_COLUMNS})
     SELECT ?, id, name, ?, quantity - ?, quantity, ?, ?, ?, ? FROM items WHERE id = ?`,
    e.action, delta, delta, e.amount ?? null, e.reference || '', e.reason || '', e.details || '', itemId
  );
}

interface BatchRow { id: number; item_id: number; quantity: number }

/** Open cost/expiry batches for some items, in the order stock leaves the shelf (soonest expiry first, then oldest). */
async function openBatches(itemIds: number[]): Promise<BatchRow[]> {
  if (itemIds.length === 0) return [];
  const db = await currentDb();
  return db
    .prepare<BatchRow>(
      `SELECT id, item_id, quantity FROM stock_batches
        WHERE item_id IN (${itemIds.map(() => '?').join(',')}) AND quantity > 0
        ORDER BY item_id, (expiry_date IS NULL) ASC, expiry_date ASC, created_at ASC, id ASC`
    )
    .all(...itemIds);
}

/**
 * Statements that take `qty` out of an item's batches, oldest/soonest-expiring
 * first. Mutates `batches` so several lines of the same item in one bill draw
 * down correctly.
 */
function consumeBatchStmts(batches: BatchRow[], itemId: number, qty: number): Statement[] {
  const out: Statement[] = [];
  let remaining = qty;
  for (const b of batches) {
    if (remaining <= 0) break;
    if (b.item_id !== itemId || b.quantity <= 0) continue;
    const take = Math.min(b.quantity, remaining);
    b.quantity -= take;
    remaining -= take;
    out.push(sql('UPDATE stock_batches SET quantity = MAX(0, quantity - ?) WHERE id = ?', take, b.id));
  }
  return out;
}

const EDITABLE_FIELDS: { key: keyof Item; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'barcode', label: 'Barcode' },
  { key: 'category', label: 'Category' },
  { key: 'cost_price', label: 'Cost price' },
  { key: 'sale_price', label: 'Sale price' },
  { key: 'unit', label: 'Unit' },
  { key: 'unit_type', label: 'Item type' },
  { key: 'low_stock_threshold', label: 'Low stock alert' },
];

/** The id of the newest active item with this name key — for referring to an item inserted earlier in the same batch. */
const NEW_ITEM_ID = '(SELECT MAX(id) FROM items WHERE name_key = ? AND archived = 0)';

// ── ITEMS ────────────────────────────────────────────────────────────────────
export const itemsRepo = {
  async search(q: string): Promise<Item[]> {
    const db = await currentDb();
    if (!q.trim()) {
      return db.prepare<Item>('SELECT * FROM items WHERE archived = 0 ORDER BY name ASC').all();
    }
    const like = `%${q}%`;
    return db
      .prepare<Item>(
        `SELECT * FROM items WHERE archived = 0 AND (name LIKE ? OR category LIKE ? OR barcode = ? OR CAST(id AS TEXT) = ?)
         ORDER BY name ASC LIMIT 500`
      )
      .all(like, like, q, q);
  },
  async getById(id: number): Promise<Item | undefined> {
    const db = await currentDb();
    return db.prepare<Item>('SELECT * FROM items WHERE id = ?').get(id);
  },
  async getByBarcode(barcode: string): Promise<Item | undefined> {
    const db = await currentDb();
    return db.prepare<Item>('SELECT * FROM items WHERE barcode = ? AND archived = 0').get(barcode);
  },
  async all(): Promise<Item[]> {
    const db = await currentDb();
    return db.prepare<Item>('SELECT * FROM items WHERE archived = 0 ORDER BY name ASC').all();
  },
  async lowStock(): Promise<Item[]> {
    const db = await currentDb();
    return db
      .prepare<Item>('SELECT * FROM items WHERE archived = 0 AND quantity <= low_stock_threshold ORDER BY quantity ASC LIMIT 50')
      .all();
  },
  /** An active item whose name matches `name` ignoring case/spacing/punctuation (indexed lookup). */
  async findByName(name: string, exceptId = 0): Promise<Item | undefined> {
    const key = normalizeItemName(name);
    if (!key) return undefined;
    const db = await currentDb();
    return db.prepare<Item>('SELECT * FROM items WHERE name_key = ? AND archived = 0 AND id != ? ORDER BY id LIMIT 1').get(key, exceptId);
  },
  async create(data: Partial<Item>, opts: { action?: 'ITEM_CREATE' | 'IMPORT'; reference?: string } = {}): Promise<Item> {
    const name = (data.name || '').trim();
    const key = normalizeItemName(name);
    const existing = await this.findByName(name);
    if (existing) throw new DuplicateItemError(existing);
    const qty = data.quantity ?? 0;
    const cost = data.cost_price ?? 0;

    const stmts: Statement[] = [
      sql(
        `INSERT INTO items (barcode, name, name_key, category, cost_price, sale_price, quantity, unit, unit_type, low_stock_threshold)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        data.barcode || null, name, key, data.category || 'General', cost, data.sale_price ?? 0,
        qty, data.unit || 'Pcs', data.unit_type || 'COUNT', data.low_stock_threshold ?? 5
      ),
      sql(
        `INSERT INTO activity_log (${LOG_COLUMNS}) VALUES (?, ${NEW_ITEM_ID}, ?, NULL, NULL, NULL, NULL, ?, '', ?)`,
        opts.action || 'ITEM_CREATE', key, name, opts.reference || '', `New item — cost ${cost}, sale ${data.sale_price ?? 0}`
      ),
    ];
    if (qty > 0) {
      stmts.push(
        sql(`INSERT INTO stock_batches (item_id, quantity, cost_price) VALUES (${NEW_ITEM_ID}, ?, ?)`, key, qty, cost),
        sql(
          `INSERT INTO activity_log (${LOG_COLUMNS}) VALUES ('OPENING', ${NEW_ITEM_ID}, ?, ?, 0, ?, ?, '', 'Opening stock', '')`,
          key, name, qty, qty, qty * cost
        )
      );
    }
    await writeBatch(stmts);
    return (await this.findByName(name))!;
  },
  /**
   * Edits an item's details. Quantity is deliberately NOT editable here — a form
   * opened before a sale would otherwise write back its stale quantity and silently
   * undo that sale. Quantity only changes through adjust()/sales/purchases/returns.
   */
  async update(id: number, data: Partial<Item>, opts: { action?: 'ITEM_EDIT' | 'IMPORT'; reference?: string } = {}): Promise<Item | undefined> {
    const current = await this.getById(id);
    if (!current) return undefined;
    if (data.name !== undefined && normalizeItemName(data.name) !== normalizeItemName(current.name)) {
      const clash = await this.findByName(data.name, id);
      if (clash) throw new DuplicateItemError(clash);
    }
    const next: Item = { ...current };
    const changes: string[] = [];
    for (const { key, label } of EDITABLE_FIELDS) {
      const value = data[key];
      if (value === undefined) continue;
      const normalized = key === 'barcode' ? (value || null) : key === 'name' ? String(value).trim() : value;
      if (normalized !== current[key]) {
        changes.push(`${label}: ${current[key] ?? '—'} → ${normalized ?? '—'}`);
        (next as unknown as Record<string, unknown>)[key] = normalized;
      }
    }
    if (changes.length === 0) return current;
    await writeBatch([
      sql(
        `UPDATE items SET barcode=?, name=?, name_key=?, category=?, cost_price=?, sale_price=?, unit=?, unit_type=?,
         low_stock_threshold=?, updated_at=datetime('now') WHERE id=?`,
        next.barcode, next.name, normalizeItemName(next.name), next.category, next.cost_price, next.sale_price,
        next.unit, next.unit_type, next.low_stock_threshold, id
      ),
      logStmt({ action: opts.action || 'ITEM_EDIT', itemId: id, itemName: next.name, reference: opts.reference, details: changes.join('; ') }),
    ]);
    return this.getById(id);
  },
  /** Manual stock correction: add, remove, or set to a counted quantity — always with a reason. */
  async adjust(id: number, input: { mode: 'ADD' | 'REMOVE' | 'SET'; quantity: number; reason: string; notes?: string; action?: 'ADJUST' | 'IMPORT' }) {
    const item = await this.getById(id);
    if (!item) throw new Error('Item not found');
    const qty = Number(input.quantity);
    if (!Number.isFinite(qty) || qty < 0) throw new Error('Enter a valid quantity');
    const delta = input.mode === 'ADD' ? qty : input.mode === 'REMOVE' ? -qty : qty - item.quantity;
    if (delta === 0) throw new Error(input.mode === 'SET' ? `Stock is already ${item.quantity}` : 'Quantity must be more than 0');

    const log = { action: input.action || 'ADJUST', reason: input.reason || 'Correction', details: input.notes || '', amount: Math.abs(delta) * item.cost_price } as const;
    const stmts: Statement[] = [];
    if (input.mode === 'SET') {
      // Log first, reading the live quantity, then overwrite it with the count.
      stmts.push(
        sql(
          `INSERT INTO activity_log (${LOG_COLUMNS})
           SELECT ?, id, name, ? - quantity, quantity, ?, ?, '', ?, ? FROM items WHERE id = ?`,
          log.action, qty, qty, log.amount, log.reason, log.details, id
        ),
        sql("UPDATE items SET quantity = ?, updated_at = datetime('now') WHERE id = ?", qty, id)
      );
    } else {
      stmts.push(
        sql("UPDATE items SET quantity = quantity + ?, updated_at = datetime('now') WHERE id = ?", delta, id),
        logAfterChangeStmt(id, delta, log)
      );
    }
    if (delta > 0) {
      stmts.push(sql('INSERT INTO stock_batches (item_id, quantity, cost_price) VALUES (?, ?, ?)', id, delta, item.cost_price));
    } else {
      stmts.push(...consumeBatchStmts(await openBatches([id]), id, -delta));
    }
    await writeBatch(stmts);
    return (await this.getById(id))!;
  },
  /** How many sales/purchases/returns reference this item — those records must keep pointing at it. */
  async referenceCount(id: number) {
    const db = await currentDb();
    const r = (await db
      .prepare<{ c: number }>(
        `SELECT (SELECT COUNT(*) FROM bill_items WHERE item_id = ?) + (SELECT COUNT(*) FROM purchase_items WHERE item_id = ?)
              + (SELECT COUNT(*) FROM return_items WHERE item_id = ?) AS c`
      )
      .get(id, id, id))!;
    return r.c;
  },
  /**
   * Items that appear on old bills/purchases can't be hard-deleted (the database
   * blocks it, which is why deletes used to silently do nothing) — they're archived
   * instead: hidden from stock and billing, but past reports still resolve them.
   */
  async remove(id: number): Promise<{ archived: boolean }> {
    const item = await this.getById(id);
    if (!item) throw new Error('Item not found');
    const refs = await this.referenceCount(id);
    if (refs > 0) {
      await writeBatch([
        sql("UPDATE items SET archived = 1, barcode = NULL, updated_at = datetime('now') WHERE id = ?", id),
        logStmt({
          action: 'ITEM_ARCHIVE', itemId: id, itemName: item.name, qtyBefore: item.quantity,
          details: `Removed from stock (kept for ${refs} past bill/purchase line${refs === 1 ? '' : 's'})${item.barcode ? `; barcode ${item.barcode} freed` : ''}`,
        }),
      ]);
      return { archived: true };
    }
    await writeBatch([
      sql('DELETE FROM stock_batches WHERE item_id = ?', id),
      sql('UPDATE activity_log SET item_id = NULL WHERE item_id = ?', id),
      sql('DELETE FROM items WHERE id = ?', id),
      logStmt({ action: 'ITEM_DELETE', itemName: item.name, qtyBefore: item.quantity, details: `Deleted item #${id}` }),
    ]);
    return { archived: false };
  },
  /**
   * Folds a duplicate item into the one being kept: its sales/purchase/return
   * history and batches move over, its stock is added on, and the duplicate is
   * deleted. Reports then show one product instead of two.
   */
  async merge(sourceId: number, targetId: number): Promise<Item> {
    if (sourceId === targetId) throw new Error('Pick a different item to merge');
    const [source, target] = await Promise.all([this.getById(sourceId), this.getById(targetId)]);
    if (!source || !target) throw new Error('Item not found');
    await writeBatch([
      // Free the duplicate's barcode first — barcodes are unique, so the kept item can take it.
      sql('UPDATE items SET barcode = NULL WHERE id = ?', sourceId),
      ...['bill_items', 'purchase_items', 'return_items', 'stock_batches', 'activity_log'].map((t) =>
        sql(`UPDATE ${t} SET item_id = ? WHERE item_id = ?`, targetId, sourceId)
      ),
      sql(
        `UPDATE items SET quantity = quantity + (SELECT quantity FROM items WHERE id = ?),
                barcode = COALESCE(barcode, ?), updated_at = datetime('now') WHERE id = ?`,
        sourceId, source.barcode, targetId
      ),
      // Not a stock movement of its own: the duplicate's sales/purchases now count
      // under the kept item, so only before/after is recorded here.
      sql(
        `INSERT INTO activity_log (${LOG_COLUMNS})
         SELECT 'ITEM_MERGE', t.id, t.name, NULL, t.quantity - s.quantity, t.quantity, NULL, '', '', ?
           FROM items t, items s WHERE t.id = ? AND s.id = ?`,
        `Merged duplicate "${source.name}" (#${sourceId}, stock ${source.quantity}) into this item`, targetId, sourceId
      ),
      sql('DELETE FROM items WHERE id = ?', sourceId),
    ]);
    return (await this.getById(targetId))!;
  },
  /** Groups of active items whose names only differ by case, spaces or punctuation. */
  async duplicates(): Promise<Item[][]> {
    const db = await currentDb();
    const rows = await db
      .prepare<Item>(
        `SELECT * FROM items WHERE archived = 0 AND name_key IN
           (SELECT name_key FROM items WHERE archived = 0 AND name_key != '' GROUP BY name_key HAVING COUNT(*) > 1)
         ORDER BY name_key, id`
      )
      .all();
    const groups = new Map<string, Item[]>();
    for (const r of rows) groups.set(r.name_key, [...(groups.get(r.name_key) || []), r]);
    return Array.from(groups.values());
  },
  /**
   * Every change to one item's stock, newest first: sales, purchases and returns
   * read from their own tables plus manual changes from the activity log. Running
   * stock (before → after) is worked out backwards from the current quantity for
   * everything since history tracking started.
   */
  async history(id: number) {
    const item = await this.getById(id);
    if (!item) return null;
    const union = itemMovementsSql();
    const [rows, sums, started] = await readBatch([
      sql(`SELECT * FROM (${union}) ORDER BY created_at DESC, id DESC LIMIT 1000`, id, id, id, id),
      sql(`SELECT COALESCE(SUM(qty_change), 0) AS s FROM (${union})`, id, id, id, id),
      sql("SELECT value FROM settings WHERE key = 'history_started'"),
    ]);
    const historyStart = (started[0]?.value as string | undefined) || '';
    const entries = rows as unknown as ActivityEntry[];
    let running = item.quantity;
    let tracked = true;
    for (const e of entries) {
      if (e.qty_before !== null && e.qty_after !== null) {
        // Exact values recorded at the time — re-anchor on them.
        running = e.qty_before;
        continue;
      }
      if (e.qty_change === null) continue;
      if (tracked && historyStart && e.created_at < historyStart) tracked = false;
      if (tracked) {
        e.qty_after = running;
        e.qty_before = running - e.qty_change;
      }
      running -= e.qty_change;
    }
    return { item, entries, unrecorded: item.quantity - Number(sums[0]?.s || 0) };
  },
  async expiringBatches(withinDays: number) {
    const db = await currentDb();
    return db
      .prepare(
        `SELECT sb.*, i.name AS item_name, i.unit AS item_unit
         FROM stock_batches sb JOIN items i ON i.id = sb.item_id
         WHERE sb.quantity > 0 AND sb.expiry_date IS NOT NULL AND i.archived = 0
           AND date(sb.expiry_date) <= date('now', '+' || ? || ' days')
         ORDER BY sb.expiry_date ASC LIMIT 100`
      )
      .all(withinDays);
  },
};

const ACTIVITY_COLUMNS = 'id, action, item_id, item_name, qty_change, qty_before, qty_after, amount, reference, reason, details, created_at';

/** Activity rows from the shop's own records — sales, purchases, returns, expenses — in the activity_log column shape. */
const SOURCE_SQL = {
  log: `SELECT 'L' || id AS id, action, item_id, item_name, qty_change, qty_before, qty_after, amount, reference, reason, details, created_at
          FROM activity_log`,
  sale: `SELECT 'S' || bi.id AS id, 'SALE' AS action, bi.item_id AS item_id, bi.name AS item_name, -bi.quantity AS qty_change,
                NULL AS qty_before, NULL AS qty_after, bi.total AS amount, b.bill_number AS reference,
                'Sold to ' || b.customer_name AS reason,
                CASE WHEN bi.returned_quantity > 0 THEN printf('%g later returned', bi.returned_quantity) ELSE '' END AS details,
                b.created_at AS created_at
           FROM bill_items bi JOIN bills b ON b.id = bi.bill_id`,
  purchase: `SELECT 'P' || pi.id AS id, 'PURCHASE' AS action, pi.item_id AS item_id, pi.name AS item_name, pi.quantity AS qty_change,
                    NULL AS qty_before, NULL AS qty_after, pi.total AS amount, p.purchase_number AS reference,
                    CASE p.payment_type WHEN 'CREDIT' THEN 'Credit' ELSE 'Cash' END || ' purchase from ' || p.supplier_name AS reason,
                    printf('%g × Rs %g', pi.quantity, pi.cost_price)
                      || CASE WHEN pi.expiry_date IS NOT NULL THEN '; expiry ' || pi.expiry_date ELSE '' END
                      || CASE WHEN COALESCE(p.notes, '') != '' THEN '; ' || p.notes ELSE '' END AS details,
                    p.created_at AS created_at
               FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id`,
  return: `SELECT 'R' || ri.id AS id, 'RETURN' AS action, ri.item_id AS item_id, bi.name AS item_name, ri.quantity AS qty_change,
                  NULL AS qty_before, NULL AS qty_after, ri.total AS amount, r.return_number AS reference,
                  'Returned from bill ' || b.bill_number AS reason, COALESCE(r.notes, '') AS details, r.created_at AS created_at
             FROM return_items ri JOIN returns r ON r.id = ri.return_id
             JOIN bill_items bi ON bi.id = ri.bill_item_id JOIN bills b ON b.id = r.bill_id`,
  expense: `SELECT 'E' || id AS id, 'EXPENSE' AS action, NULL AS item_id, NULL AS item_name, NULL AS qty_change,
                   NULL AS qty_before, NULL AS qty_after, amount, 'EXP-' || id AS reference, category AS reason,
                   TRIM(COALESCE(description, '') || ' (for ' || expense_date || ')') AS details, created_at
              FROM expenses`,
};

/** One item's stock movements from every source (4 `?` = the item id). */
function itemMovementsSql() {
  return [
    `${SOURCE_SQL.log} WHERE item_id = ?`,
    `${SOURCE_SQL.sale} WHERE bi.item_id = ?`,
    `${SOURCE_SQL.purchase} WHERE pi.item_id = ?`,
    `${SOURCE_SQL.return} WHERE ri.item_id = ?`,
  ].join(' UNION ALL ');
}

// ── SUPPLIERS ────────────────────────────────────────────────────────────────
export const suppliersRepo = {
  async search(q: string): Promise<Supplier[]> {
    const db = await currentDb();
    if (!q.trim()) return db.prepare<Supplier>('SELECT * FROM suppliers ORDER BY name ASC').all();
    return db.prepare<Supplier>('SELECT * FROM suppliers WHERE name LIKE ? ORDER BY name ASC').all(`%${q}%`);
  },
  async getById(id: number): Promise<Supplier | undefined> {
    const db = await currentDb();
    return db.prepare<Supplier>('SELECT * FROM suppliers WHERE id = ?').get(id);
  },
  async create(data: { name: string; phone?: string; address?: string }): Promise<Supplier> {
    const db = await currentDb();
    const info = await db
      .prepare('INSERT INTO suppliers (name, phone, address) VALUES (?, ?, ?)')
      .run(data.name, data.phone || '', data.address || '');
    return (await this.getById(info.lastInsertRowid))!;
  },
  async ledger(id: number) {
    const db = await currentDb();
    return db.prepare('SELECT * FROM supplier_ledger WHERE supplier_id = ? ORDER BY date DESC').all(id);
  },
  async logPayment(supplierId: number, amount: number, notes: string): Promise<Supplier> {
    await writeBatch([
      sql('UPDATE suppliers SET balance = balance - ? WHERE id = ?', amount, supplierId),
      sql('INSERT INTO supplier_ledger (supplier_id, amount, type, notes) VALUES (?, ?, ?, ?)', supplierId, amount, 'PAYMENT', notes || ''),
    ]);
    return (await this.getById(supplierId))!;
  },
};

// ── PURCHASES ────────────────────────────────────────────────────────────────
interface PurchaseInput {
  supplierId: number | null;
  supplierName: string;
  paymentType: 'CASH' | 'CREDIT';
  notes?: string;
  items: { itemId: number | null; name: string; quantity: number; costPrice: number; expiryDate: string | null; salePrice?: number; category?: string; unit?: string }[];
}

export const purchasesRepo = {
  async create(input: PurchaseInput): Promise<Purchase> {
    const lines = input.items.filter((l) => l.name.trim() && l.quantity > 0);
    if (lines.length === 0) throw new Error('Purchase must contain at least one item');
    const subtotal = lines.reduce((s, i) => s + i.quantity * i.costPrice, 0);
    const supplierName = input.supplierName || 'Unknown Supplier';

    // Resolve every line to an existing item up front (one read): typing an
    // existing item's name without picking it from the suggestions must reuse that
    // item, not create a second copy of it.
    const db = await currentDb();
    const ids = lines.map((l) => l.itemId).filter((x): x is number => !!x);
    const keys = lines.filter((l) => !l.itemId).map((l) => normalizeItemName(l.name)).filter(Boolean);
    const known = ids.length || keys.length
      ? await db
          .prepare<Item>(
            `SELECT * FROM items WHERE id IN (${ids.map(() => '?').join(',') || 'NULL'})
                OR (archived = 0 AND name_key IN (${keys.map(() => '?').join(',') || 'NULL'}))`
          )
          .all(...ids, ...keys)
      : [];
    const byId = new Map(known.map((i) => [i.id, i]));
    const byKey = new Map(known.filter((i) => !i.archived).map((i) => [i.name_key, i]));

    return withFreshNumber(generatePurchaseNumber, 'purchase_number', async (purchaseNumber) => {
      const PURCHASE_ID = '(SELECT id FROM purchases WHERE purchase_number = ?)';
      const stmts: Statement[] = [
        sql(
          `INSERT INTO purchases (purchase_number, supplier_id, supplier_name, payment_type, subtotal, total, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          purchaseNumber, input.supplierId, supplierName, input.paymentType, subtotal, subtotal, input.notes || ''
        ),
      ];
      const created = new Set<string>();

      for (const line of lines) {
        const key = normalizeItemName(line.name);
        const existing = (line.itemId && byId.get(line.itemId)) || byKey.get(key);
        // Either a literal id, or a lookup of the item created earlier in this batch.
        const ref = existing ? { frag: '?', arg: existing.id as unknown } : { frag: NEW_ITEM_ID, arg: key as unknown };
        if (!existing && !created.has(key)) {
          created.add(key);
          stmts.push(
            sql(
              `INSERT INTO items (name, name_key, category, cost_price, sale_price, quantity, unit) VALUES (?, ?, ?, ?, ?, 0, ?)`,
              line.name.trim(), key, line.category || 'General', line.costPrice, line.salePrice ?? line.costPrice, line.unit || 'Pcs'
            ),
            sql(
              `INSERT INTO activity_log (${LOG_COLUMNS}) VALUES ('ITEM_CREATE', ${NEW_ITEM_ID}, ?, NULL, NULL, NULL, NULL, ?, '', ?)`,
              key, line.name.trim(), purchaseNumber, `New item from purchase — cost ${line.costPrice}`
            )
          );
        }
        const total = line.quantity * line.costPrice;
        stmts.push(
          sql(
            `INSERT INTO purchase_items (purchase_id, item_id, name, quantity, cost_price, expiry_date, total)
             VALUES (${PURCHASE_ID}, ${ref.frag}, ?, ?, ?, ?, ?)`,
            purchaseNumber, ref.arg, line.name.trim(), line.quantity, line.costPrice, line.expiryDate || null, total
          ),
          sql(
            `UPDATE items SET quantity = quantity + ?, cost_price = ?, updated_at = datetime('now') WHERE id = ${ref.frag}`,
            line.quantity, line.costPrice, ref.arg
          ),
          sql(
            `INSERT INTO stock_batches (item_id, quantity, cost_price, expiry_date, purchase_id)
             VALUES (${ref.frag}, ?, ?, ?, ${PURCHASE_ID})`,
            ref.arg, line.quantity, line.costPrice, line.expiryDate || null, purchaseNumber
          )
        );
        if (existing && existing.cost_price !== line.costPrice) {
          stmts.push(logStmt({
            action: 'ITEM_EDIT', itemId: existing.id, itemName: existing.name, reference: purchaseNumber,
            details: `Cost price: ${existing.cost_price} → ${line.costPrice} (from purchase)`,
          }));
          existing.cost_price = line.costPrice;
        }
      }

      if (input.supplierId) {
        stmts.push(
          sql('UPDATE suppliers SET balance = balance + ? WHERE id = ?', input.paymentType === 'CREDIT' ? subtotal : 0, input.supplierId),
          sql(
            `INSERT INTO supplier_ledger (supplier_id, amount, type, notes, purchase_id) VALUES (?, ?, 'PURCHASE', ?, ${PURCHASE_ID})`,
            input.supplierId, subtotal, purchaseNumber, purchaseNumber
          )
        );
      }

      await writeBatch(stmts);
      const p = await db.prepare<{ id: number }>('SELECT id FROM purchases WHERE purchase_number = ?').get(purchaseNumber);
      return this.getById(p!.id);
    });
  },
  async getById(id: number): Promise<Purchase> {
    const [[purchase], items] = await readBatch([
      sql('SELECT * FROM purchases WHERE id = ?', id),
      sql('SELECT * FROM purchase_items WHERE purchase_id = ?', id),
    ]);
    return { ...(purchase as unknown as Purchase), items: items as unknown as PurchaseItem[] };
  },
  async list(limit = 100): Promise<(Purchase & { item_count: number })[]> {
    const db = await currentDb();
    return db
      .prepare<Purchase & { item_count: number }>(
        `SELECT p.*, (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) AS item_count
           FROM purchases p ORDER BY p.created_at DESC LIMIT ?`
      )
      .all(limit);
  },
};

// ── CUSTOMERS ────────────────────────────────────────────────────────────────
export const customersRepo = {
  async search(q: string): Promise<Customer[]> {
    const db = await currentDb();
    const rows = q.trim()
      ? await db.prepare<Customer>('SELECT * FROM customers WHERE (name LIKE ? OR phone LIKE ?) ORDER BY name ASC').all(`%${q}%`, `%${q}%`)
      : await db.prepare<Customer>('SELECT * FROM customers ORDER BY name ASC').all();
    if (rows.length === 0) return [];
    // One query for all the ledgers, instead of one query per customer.
    const ledger = await db
      .prepare<CustomerLedgerEntry>(
        `SELECT * FROM customer_ledger WHERE customer_id IN (${rows.map(() => '?').join(',')}) ORDER BY date ASC`
      )
      .all(...rows.map((c) => c.id));
    const byCustomer = new Map<number, CustomerLedgerEntry[]>();
    for (const e of ledger) byCustomer.set(e.customer_id, [...(byCustomer.get(e.customer_id) || []), e]);
    return rows.map((c) => ({ ...c, ledger: byCustomer.get(c.id) || [] }));
  },
  async getById(id: number): Promise<Customer | undefined> {
    const [[c], ledger] = await readBatch([
      sql('SELECT * FROM customers WHERE id = ?', id),
      sql('SELECT * FROM customer_ledger WHERE customer_id = ? ORDER BY date ASC', id),
    ]);
    if (!c) return undefined;
    return { ...(c as unknown as Customer), ledger: ledger as unknown as CustomerLedgerEntry[] };
  },
  async create(data: { name: string; phone?: string }): Promise<Customer> {
    const db = await currentDb();
    const info = await db.prepare('INSERT INTO customers (name, phone) VALUES (?, ?)').run(data.name, data.phone || '');
    return (await this.getById(info.lastInsertRowid))!;
  },
  async logPayment(customerId: number, amount: number, notes: string): Promise<Customer> {
    await writeBatch([
      sql('UPDATE customers SET balance = balance - ? WHERE id = ?', amount, customerId),
      sql('INSERT INTO customer_ledger (customer_id, amount, type, notes) VALUES (?, ?, ?, ?)', customerId, amount, 'PAYMENT', notes || ''),
    ]);
    return (await this.getById(customerId))!;
  },
  async remove(id: number) {
    const db = await currentDb();
    // Past bills keep their own customer_name text, so removing the customer record
    // doesn't affect bill history — only the ledger (cascades) and future lookups.
    await db.prepare('DELETE FROM customers WHERE id = ?').run(id);
  },
};

// ── BILLS ────────────────────────────────────────────────────────────────────
interface BillInput {
  items: { itemId: number | null; name: string; quantity: number; price: number; total: number; costPrice?: number | null }[];
  discount: number;
  paymentType: 'CASH' | 'CARD' | 'UDHAAR';
  customerId: number | null;
  customerName: string;
  /** Random id the till generates once per sale, so a repeated submit of the same sale is ignored. */
  clientRef?: string | null;
}

export const billsRepo = {
  /**
   * The whole sale — bill, lines, stock deductions, udhaar entry — is written in a
   * single atomic request. Stock is decremented relatively (quantity - n) so two
   * tills selling at once can't overwrite each other.
   */
  async create(input: BillInput): Promise<Bill> {
    const db = await currentDb();
    if (input.clientRef) {
      const dup = await db.prepare<{ id: number }>('SELECT id FROM bills WHERE client_ref = ?').get(input.clientRef);
      if (dup) return this.getById(dup.id);
    }
    const subtotal = input.items.reduce((s, i) => s + i.total, 0);
    const total = Math.max(0, subtotal - (input.discount || 0));
    const customerName = input.customerName || 'Walk-in Customer';
    const itemIds = [...new Set(input.items.map((l) => l.itemId).filter((x): x is number => !!x))];
    const batchesTemplate = await openBatches(itemIds);

    try {
      return await withFreshNumber(generateBillNumber, 'bill_number', async (billNumber) => {
        const BILL_ID = '(SELECT id FROM bills WHERE bill_number = ?)';
        const batches = batchesTemplate.map((b) => ({ ...b }));
        const stmts: Statement[] = [
          sql(
            `INSERT INTO bills (bill_number, customer_id, customer_name, payment_type, subtotal, discount, total, client_ref)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            billNumber, input.customerId, customerName, input.paymentType, subtotal, input.discount || 0, total, input.clientRef || null
          ),
        ];
        for (const line of input.items) {
          stmts.push(sql(
            `INSERT INTO bill_items (bill_id, item_id, name, quantity, price, total, cost_price) VALUES (${BILL_ID}, ?, ?, ?, ?, ?, ?)`,
            billNumber, line.itemId, line.name, line.quantity, line.price, line.total, line.costPrice ?? null
          ));
          if (line.itemId) {
            stmts.push(
              sql("UPDATE items SET quantity = quantity - ?, updated_at = datetime('now') WHERE id = ?", line.quantity, line.itemId),
              ...consumeBatchStmts(batches, line.itemId, line.quantity)
            );
          }
        }
        if (input.paymentType === 'UDHAAR' && input.customerId) {
          stmts.push(
            sql('UPDATE customers SET balance = balance + ? WHERE id = ?', total, input.customerId),
            sql(
              `INSERT INTO customer_ledger (customer_id, amount, type, bill_id, notes) VALUES (?, ?, 'CREDIT', ${BILL_ID}, ?)`,
              input.customerId, total, billNumber, billNumber
            )
          );
        }
        await writeBatch(stmts);
        return (await this.getByNumber(billNumber))!;
      });
    } catch (e) {
      // The same sale submitted twice at the same instant: the first one won.
      if (input.clientRef && isUniqueViolation(e, 'client_ref')) {
        const dup = await db.prepare<{ id: number }>('SELECT id FROM bills WHERE client_ref = ?').get(input.clientRef);
        if (dup) return this.getById(dup.id);
      }
      throw e;
    }
  },
  async getById(id: number): Promise<Bill> {
    const [[bill], items] = await readBatch([
      sql('SELECT * FROM bills WHERE id = ?', id),
      sql('SELECT * FROM bill_items WHERE bill_id = ?', id),
    ]);
    return { ...(bill as unknown as Bill), items: items as unknown as BillItem[] };
  },
  async getByNumber(billNumber: string): Promise<Bill | undefined> {
    const [[bill], items] = await readBatch([
      sql('SELECT * FROM bills WHERE bill_number = ?', billNumber),
      sql('SELECT bi.* FROM bill_items bi JOIN bills b ON b.id = bi.bill_id WHERE b.bill_number = ?', billNumber),
    ]);
    if (!bill) return undefined;
    return { ...(bill as unknown as Bill), items: items as unknown as BillItem[] };
  },
  async list(opts: { limit?: number; from?: string; to?: string; type?: string } = {}): Promise<Bill[]> {
    const db = await currentDb();
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (opts.from) { clauses.push('created_at >= ?'); params.push(sqlTimestampOf(opts.from)); }
    if (opts.to) { clauses.push('created_at <= ?'); params.push(sqlTimestampOf(opts.to)); }
    if (opts.type && opts.type !== 'ALL') { clauses.push('payment_type = ?'); params.push(opts.type); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return db.prepare<Bill>(`SELECT * FROM bills ${where} ORDER BY created_at DESC LIMIT ?`).all(...params, opts.limit || 200);
  },
};

// ── RETURNS ──────────────────────────────────────────────────────────────────
interface ReturnInput {
  billId: number;
  lines: { billItemId: number; quantity: number }[];
  refundMethod: 'CASH' | 'UDHAAR_ADJUST';
  notes: string;
}

export const returnsRepo = {
  async create(input: ReturnInput) {
    const bill = await billsRepo.getById(input.billId);
    if (!bill?.id) throw new Error('Bill not found');
    const items = (bill.items || []).map((i) => ({ ...i }));

    const accepted: { billItem: BillItem; qty: number; lineTotal: number }[] = [];
    for (const line of input.lines) {
      const billItem = items.find((i) => i.id === line.billItemId);
      if (!billItem) continue;
      const qty = Math.min(line.quantity, billItem.quantity - billItem.returned_quantity);
      if (qty <= 0) continue;
      billItem.returned_quantity += qty;
      accepted.push({ billItem, qty, lineTotal: qty * billItem.price });
    }
    if (accepted.length === 0) throw new Error('Nothing left to return on this bill');
    const refundAmount = accepted.reduce((s, a) => s + a.lineTotal, 0);
    const status = items.every((i) => i.returned_quantity >= i.quantity) ? 'RETURNED' : 'PARTIAL_RETURN';

    return withFreshNumber(generateReturnNumber, 'return_number', async (returnNumber) => {
      const RETURN_ID = '(SELECT id FROM returns WHERE return_number = ?)';
      const stmts: Statement[] = [
        sql(
          'INSERT INTO returns (return_number, bill_id, refund_amount, refund_method, notes) VALUES (?, ?, ?, ?, ?)',
          returnNumber, input.billId, refundAmount, input.refundMethod, input.notes || ''
        ),
      ];
      for (const { billItem, qty, lineTotal } of accepted) {
        stmts.push(
          sql('UPDATE bill_items SET returned_quantity = returned_quantity + ? WHERE id = ?', qty, billItem.id),
          sql(
            `INSERT INTO return_items (return_id, bill_item_id, item_id, quantity, price, total) VALUES (${RETURN_ID}, ?, ?, ?, ?, ?)`,
            returnNumber, billItem.id, billItem.item_id, qty, billItem.price, lineTotal
          )
        );
        if (billItem.item_id) {
          stmts.push(
            sql("UPDATE items SET quantity = quantity + ?, updated_at = datetime('now') WHERE id = ?", qty, billItem.item_id),
            sql(
              `INSERT INTO stock_batches (item_id, quantity, cost_price)
               VALUES (?, ?, COALESCE(?, (SELECT cost_price FROM items WHERE id = ?), 0))`,
              billItem.item_id, qty, billItem.cost_price, billItem.item_id
            )
          );
        }
      }
      stmts.push(sql('UPDATE bills SET status = ? WHERE id = ?', status, input.billId));
      if (input.refundMethod === 'UDHAAR_ADJUST' && bill.customer_id) {
        stmts.push(
          sql('UPDATE customers SET balance = balance - ? WHERE id = ?', refundAmount, bill.customer_id),
          sql(
            "INSERT INTO customer_ledger (customer_id, amount, type, bill_id, notes) VALUES (?, ?, 'PAYMENT', ?, ?)",
            bill.customer_id, refundAmount, input.billId, `Return ${returnNumber}`
          )
        );
      }
      await writeBatch(stmts);
      const db = await currentDb();
      return (await db.prepare<{ id: number }>('SELECT id FROM returns WHERE return_number = ?').get(returnNumber))!.id;
    });
  },
};

// ── ACTIVITY LOG ─────────────────────────────────────────────────────────────
type Source = keyof typeof SOURCE_SQL;

/** Which records each filter on the Activity page shows. `actions` narrows the activity_log part. */
const ACTIVITY_GROUPS: Record<string, { sources: Source[]; actions?: ActivityAction[] }> = {
  manual: { sources: ['log', 'purchase', 'return', 'expense'] },
  stock: { sources: ['log', 'purchase', 'return'], actions: ['ADJUST', 'OPENING', 'ITEM_MERGE', 'IMPORT'] },
  adjustments: { sources: ['log'], actions: ['ADJUST', 'OPENING'] },
  purchases: { sources: ['purchase'] },
  items: { sources: ['log'], actions: ['ITEM_CREATE', 'ITEM_EDIT', 'ITEM_DELETE', 'ITEM_ARCHIVE', 'ITEM_MERGE', 'IMPORT'] },
  expenses: { sources: ['expense', 'log'], actions: ['EXPENSE_DELETE'] },
  sales: { sources: ['sale', 'return'] },
  all: { sources: ['log', 'sale', 'purchase', 'return', 'expense'] },
};

/** Table alias whose created_at each source filters on (so the created_at index is used). */
const SOURCE_TIME: Record<Source, string> = { log: 'created_at', sale: 'b.created_at', purchase: 'p.created_at', return: 'r.created_at', expense: 'created_at' };

export const activityRepo = {
  /** Activity between two shop-local calendar dates (YYYY-MM-DD, inclusive), newest first. */
  async list(opts: { from?: string; to?: string; group?: string; q?: string; limit?: number } = {}) {
    const group = ACTIVITY_GROUPS[opts.group || 'all'] || ACTIVITY_GROUPS.all;
    const [start, end] = opts.from && opts.to ? shopDayRangeSql(opts.from, opts.to) : ['0000', '9999'];
    const params: unknown[] = [];
    const parts = group.sources.map((source) => {
      const t = SOURCE_TIME[source];
      let where = `WHERE ${t} >= ? AND ${t} < ?`;
      params.push(start, end);
      if (source === 'log' && group.actions) {
        where += ` AND action IN (${group.actions.map(() => '?').join(',')})`;
        params.push(...group.actions);
      }
      return `${SOURCE_SQL[source]} ${where}`;
    });
    let filter = '';
    if (opts.q?.trim()) {
      const like = `%${opts.q.trim()}%`;
      filter = 'WHERE item_name LIKE ? OR reference LIKE ? OR reason LIKE ? OR details LIKE ?';
      params.push(like, like, like, like);
    }
    const db = await currentDb();
    return db
      .prepare<ActivityEntry>(
        `SELECT ${ACTIVITY_COLUMNS} FROM (${parts.join(' UNION ALL ')}) ${filter} ORDER BY created_at DESC, id DESC LIMIT ?`
      )
      .all(...params, Math.min(opts.limit || 1000, 5000));
  },
};

// ── EXPENSES ─────────────────────────────────────────────────────────────────
export const EXPENSE_CATEGORIES = ['Stock Purchase', 'Rent', 'Electricity', 'Salary', 'Transport', 'Repairs', 'Packaging', 'Tea / Food', 'Other'];

export interface ExpenseRow {
  /** 'expense' rows are entered on the Expenses page; 'purchase' rows come from Purchases / Stock In. */
  source: 'expense' | 'purchase';
  id: number;
  date: string;
  category: string;
  description: string;
  amount: number;
  payment_method: string;
  reference: string;
  created_at: string;
}

export const expensesRepo = {
  async create(data: { category: string; description?: string; amount: number; paymentMethod?: string; date: string }): Promise<Expense> {
    const db = await currentDb();
    const info = await db
      .prepare('INSERT INTO expenses (category, description, amount, payment_method, expense_date) VALUES (?, ?, ?, ?, ?)')
      .run(data.category || 'Other', data.description || '', data.amount, data.paymentMethod || 'CASH', data.date);
    return (await db.prepare<Expense>('SELECT * FROM expenses WHERE id = ?').get(info.lastInsertRowid))!;
  },
  /** Deleting removes the row, so the deletion itself is what gets logged. */
  async remove(id: number) {
    const db = await currentDb();
    const e = await db.prepare<Expense>('SELECT * FROM expenses WHERE id = ?').get(id);
    if (!e) return;
    await writeBatch([
      sql('DELETE FROM expenses WHERE id = ?', id),
      logStmt({
        action: 'EXPENSE_DELETE', amount: e.amount, reference: `EXP-${id}`, reason: e.category,
        details: `Deleted expense: ${e.description || e.category} (${e.expense_date})`,
      }),
    ]);
  },
  /**
   * Everything the shop spent between two shop-local dates: manual expenses plus
   * stock purchases, so buying stock always shows up as money going out without
   * having to enter it twice.
   */
  async list(from: string, to: string) {
    const [start, end] = shopDayRangeSql(from, to);
    const db = await currentDb();
    const rows = await db
      .prepare<ExpenseRow>(
        `SELECT 'expense' AS source, id, expense_date AS date, category, description, amount, payment_method,
                'EXP-' || id AS reference, created_at
           FROM expenses WHERE expense_date >= ? AND expense_date <= ?
         UNION ALL
         SELECT 'purchase' AS source, p.id, date(datetime(p.created_at, ${SHOP_TZ_SHIFT_SQL})) AS date, 'Stock Purchase' AS category,
                p.supplier_name || ' — ' || (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) || ' item(s)'
                  || CASE WHEN COALESCE(p.notes, '') != '' THEN ' — ' || p.notes ELSE '' END AS description,
                p.total AS amount, p.payment_type AS payment_method, p.purchase_number AS reference, p.created_at
           FROM purchases p WHERE p.created_at >= ? AND p.created_at < ?
         ORDER BY date DESC, created_at DESC`
      )
      .all(from, to, start, end);
    const byCategory = new Map<string, number>();
    for (const r of rows) byCategory.set(r.category, (byCategory.get(r.category) || 0) + r.amount);
    const total = rows.reduce((s, r) => s + r.amount, 0);
    const stockTotal = rows.filter((r) => r.source === 'purchase').reduce((s, r) => s + r.amount, 0);
    return {
      rows,
      totals: { total, stockTotal, otherTotal: total - stockTotal, count: rows.length },
      byCategory: Array.from(byCategory.entries()).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    };
  },
};

// ── SETTINGS ─────────────────────────────────────────────────────────────────
/** Bookkeeping rows the app itself maintains in the settings table — not user settings. */
const INTERNAL_SETTINGS = new Set(['schema_version', 'history_started']);

export const settingsRepo = {
  async getAll(): Promise<Record<string, string>> {
    const db = await currentDb();
    const rows = await db.prepare<{ key: string; value: string }>('SELECT key, value FROM settings').all();
    return Object.fromEntries(rows.filter((r) => !INTERNAL_SETTINGS.has(r.key)).map((r) => [r.key, r.value]));
  },
  async update(values: Record<string, string>) {
    await writeBatch(
      Object.entries(values).filter(([k]) => !INTERNAL_SETTINGS.has(k)).map(([k, v]) =>
        sql('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, String(v))
      )
    );
    return this.getAll();
  },
};

// ── REPORTS ──────────────────────────────────────────────────────────────────
interface DailyBillRow {
  id: number;
  bill_number: string;
  created_at: string;
  customer_name: string;
  payment_type: string;
  status: string;
  total: number;
  item_count: number;
  cost: number;
}

export const reportsRepo = {
  /** Every bill on a given calendar day (YYYY-MM-DD), with an approximate cost/profit per bill. */
  async daily(date: string) {
    const db = await currentDb();
    const [start, end] = shopDayRangeSql(date, date);
    const bills = await db
      .prepare<DailyBillRow>(
        `SELECT b.id, b.bill_number, b.created_at, b.customer_name, b.payment_type, b.status, b.total,
                (SELECT COUNT(*) FROM bill_items bi WHERE bi.bill_id = b.id) AS item_count,
                (SELECT COALESCE(SUM(bi.quantity * COALESCE(bi.cost_price, i.cost_price, 0)), 0)
                   FROM bill_items bi LEFT JOIN items i ON i.id = bi.item_id
                  WHERE bi.bill_id = b.id) AS cost
           FROM bills b
          WHERE b.created_at >= ? AND b.created_at < ? AND b.status != 'RETURNED'
          ORDER BY b.created_at ASC`
      )
      .all(start, end);

    const totalSales = bills.reduce((s, b) => s + b.total, 0);
    const totalCost = bills.reduce((s, b) => s + b.cost, 0);
    return {
      bills: bills.map((b) => ({ ...b, profit: b.total - b.cost })),
      totals: { billCount: bills.length, totalSales, totalCost, netProfit: totalSales - totalCost },
    };
  },

  /** Sales/cost/profit grouped by month for the last `months` months (default 12), oldest first. */
  async monthly(months = 12) {
    const db = await currentDb();
    const today = shopNowParts();
    const start = shopMidnightUtc({ year: today.year, month: today.month - (months - 1), day: 1 });

    const salesRows = await db
      .prepare<{ month: string; count: number; total: number }>(
        `SELECT strftime('%Y-%m', datetime(created_at, ${SHOP_TZ_SHIFT_SQL})) AS month, COUNT(*) AS count, COALESCE(SUM(total), 0) AS total
           FROM bills WHERE status != 'RETURNED' AND created_at >= ?
          GROUP BY month`
      )
      .all(toSqlTimestamp(start));

    const costRows = await db
      .prepare<{ month: string; cost: number }>(
        `SELECT strftime('%Y-%m', datetime(b.created_at, ${SHOP_TZ_SHIFT_SQL})) AS month, COALESCE(SUM(bi.quantity * COALESCE(bi.cost_price, i.cost_price, 0)), 0) AS cost
           FROM bill_items bi JOIN bills b ON b.id = bi.bill_id LEFT JOIN items i ON i.id = bi.item_id
          WHERE b.status != 'RETURNED' AND b.created_at >= ?
          GROUP BY month`
      )
      .all(toSqlTimestamp(start));

    const salesMap = new Map(salesRows.map((r) => [r.month, r]));
    const costMap = new Map(costRows.map((r) => [r.month, r.cost]));

    const rows = [];
    for (let i = 0; i < months; i++) {
      // Date.UTC normalizes an out-of-range month itself, so this correctly carries the year.
      const cursor = new Date(Date.UTC(today.year, today.month - 1 - (months - 1) + i, 1));
      const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;
      const sales = salesMap.get(key);
      const total = sales?.total || 0;
      const cost = costMap.get(key) || 0;
      rows.push({
        month: key,
        label: cursor.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }),
        count: sales?.count || 0,
        total,
        cost,
        profit: total - cost,
      });
    }

    const totalSales = rows.reduce((s, r) => s + r.total, 0);
    const totalCost = rows.reduce((s, r) => s + r.cost, 0);
    const billCount = rows.reduce((s, r) => s + r.count, 0);
    return { rows, totals: { billCount, totalSales, totalCost, netProfit: totalSales - totalCost } };
  },

  /** Sales/cost/profit grouped by year for the last `years` years (default 5), oldest first. */
  async yearly(years = 5) {
    const db = await currentDb();
    const startYear = shopNowParts().year - (years - 1);
    const start = shopMidnightUtc({ year: startYear, month: 1, day: 1 });

    const salesRows = await db
      .prepare<{ year: string; count: number; total: number }>(
        `SELECT strftime('%Y', datetime(created_at, ${SHOP_TZ_SHIFT_SQL})) AS year, COUNT(*) AS count, COALESCE(SUM(total), 0) AS total
           FROM bills WHERE status != 'RETURNED' AND created_at >= ?
          GROUP BY year`
      )
      .all(toSqlTimestamp(start));

    const costRows = await db
      .prepare<{ year: string; cost: number }>(
        `SELECT strftime('%Y', datetime(b.created_at, ${SHOP_TZ_SHIFT_SQL})) AS year, COALESCE(SUM(bi.quantity * COALESCE(bi.cost_price, i.cost_price, 0)), 0) AS cost
           FROM bill_items bi JOIN bills b ON b.id = bi.bill_id LEFT JOIN items i ON i.id = bi.item_id
          WHERE b.status != 'RETURNED' AND b.created_at >= ?
          GROUP BY year`
      )
      .all(toSqlTimestamp(start));

    const salesMap = new Map(salesRows.map((r) => [r.year, r]));
    const costMap = new Map(costRows.map((r) => [r.year, r.cost]));

    const rows = [];
    for (let i = 0; i < years; i++) {
      const year = String(startYear + i);
      const sales = salesMap.get(year);
      const total = sales?.total || 0;
      const cost = costMap.get(year) || 0;
      rows.push({ year, count: sales?.count || 0, total, cost, profit: total - cost });
    }

    const totalSales = rows.reduce((s, r) => s + r.total, 0);
    const totalCost = rows.reduce((s, r) => s + r.cost, 0);
    const billCount = rows.reduce((s, r) => s + r.count, 0);
    return { rows, totals: { billCount, totalSales, totalCost, netProfit: totalSales - totalCost } };
  },

  /** Current inventory valuation snapshot — not date-scoped, reflects stock right now. */
  async inventory() {
    const db = await currentDb();
    const byCategory = await db
      .prepare<{ category: string; itemCount: number; totalQty: number; costValue: number; saleValue: number }>(
        `SELECT category,
                COUNT(*) AS itemCount,
                COALESCE(SUM(quantity), 0) AS totalQty,
                COALESCE(SUM(quantity * cost_price), 0) AS costValue,
                COALESCE(SUM(quantity * sale_price), 0) AS saleValue
           FROM items
          WHERE archived = 0
          GROUP BY category
          ORDER BY category ASC`
      )
      .all();

    const totals = (await db
      .prepare<{ totalItems: number; totalQty: number; totalCostValue: number; totalSaleValue: number }>(
        `SELECT COUNT(*) AS totalItems,
                COALESCE(SUM(quantity), 0) AS totalQty,
                COALESCE(SUM(quantity * cost_price), 0) AS totalCostValue,
                COALESCE(SUM(quantity * sale_price), 0) AS totalSaleValue
           FROM items WHERE archived = 0`
      )
      .get())!;

    const lowStock = (await db.prepare<{ c: number }>('SELECT COUNT(*) AS c FROM items WHERE archived = 0 AND quantity > 0 AND quantity <= low_stock_threshold').get())!;
    const outOfStock = (await db.prepare<{ c: number }>('SELECT COUNT(*) AS c FROM items WHERE archived = 0 AND quantity <= 0').get())!;

    return {
      byCategory,
      totals: {
        ...totals,
        potentialProfit: totals.totalSaleValue - totals.totalCostValue,
        lowStockCount: lowStock.c,
        outOfStockCount: outOfStock.c,
      },
    };
  },

  /** What sold, how much it cost, and the resulting profit — grouped per product, over an optional date range. */
  async products(opts: { from?: string; to?: string } = {}) {
    const db = await currentDb();
    const clauses: string[] = ["b.status != 'RETURNED'"];
    const params: string[] = [];
    if (opts.from) { clauses.push('b.created_at >= ?'); params.push(sqlTimestampOf(opts.from)); }
    if (opts.to) { clauses.push('b.created_at <= ?'); params.push(sqlTimestampOf(opts.to)); }
    const where = `WHERE ${clauses.join(' AND ')}`;

    const rows = await db
      .prepare<{ item_id: number | null; name: string; category: string; quantitySold: number; revenue: number; cost: number }>(
        `SELECT bi.item_id AS item_id,
                bi.name AS name,
                COALESCE(i.category, 'Custom') AS category,
                SUM(bi.quantity) AS quantitySold,
                SUM(bi.total) AS revenue,
                SUM(bi.quantity * COALESCE(bi.cost_price, i.cost_price, 0)) AS cost
           FROM bill_items bi
           JOIN bills b ON b.id = bi.bill_id
           LEFT JOIN items i ON i.id = bi.item_id
           ${where}
          GROUP BY bi.item_id, bi.name
          ORDER BY revenue DESC`
      )
      .all(...params);

    const products = rows.map((r) => ({ ...r, profit: r.revenue - r.cost }));
    const totalRevenue = products.reduce((s, p) => s + p.revenue, 0);
    const totalCost = products.reduce((s, p) => s + p.cost, 0);
    const totalQuantity = products.reduce((s, p) => s + p.quantitySold, 0);

    return {
      products,
      totals: { totalRevenue, totalCost, totalProfit: totalRevenue - totalCost, totalQuantity, productCount: products.length },
    };
  },

  /** A single bill with per-line cost/profit — for drilling into "what did this sale actually make". */
  async billDetail(billId: number) {
    const db = await currentDb();
    const bill = await db.prepare<Bill>('SELECT * FROM bills WHERE id = ?').get(billId);
    if (!bill) return null;

    const lines = await db
      .prepare<{
        id: number; item_id: number | null; name: string; quantity: number; price: number;
        total: number; returned_quantity: number; cost_price: number;
      }>(
        `SELECT bi.id, bi.item_id, bi.name, bi.quantity, bi.price, bi.total, bi.returned_quantity,
                COALESCE(bi.cost_price, i.cost_price, 0) AS cost_price
           FROM bill_items bi LEFT JOIN items i ON i.id = bi.item_id
          WHERE bi.bill_id = ?`
      )
      .all(billId);

    const items = lines.map((l) => {
      const cost = l.quantity * l.cost_price;
      return { ...l, cost, profit: l.total - cost };
    });
    const totalCost = items.reduce((s, i) => s + i.cost, 0);

    return { ...bill, items, totalCost, profit: bill.total - totalCost };
  },

  /**
   * Every line item sold on a given calendar day (YYYY-MM-DD), tagged with which
   * bill/customer it belongs to — lets the UI group items bought together in the
   * same sale rather than just listing products in isolation.
   */
  async soldToday(date: string) {
    const db = await currentDb();
    const [start, end] = shopDayRangeSql(date, date);
    const rows = await db
      .prepare<{
        bill_id: number; bill_number: string; customer_name: string; created_at: string;
        bill_item_id: number; item_id: number | null; name: string; quantity: number;
        price: number; total: number; cost_price: number;
      }>(
        `SELECT b.id AS bill_id, b.bill_number, b.customer_name, b.created_at,
                bi.id AS bill_item_id, bi.item_id, bi.name, bi.quantity, bi.price, bi.total,
                COALESCE(bi.cost_price, i.cost_price, 0) AS cost_price
           FROM bill_items bi
           JOIN bills b ON b.id = bi.bill_id
           LEFT JOIN items i ON i.id = bi.item_id
          WHERE b.created_at >= ? AND b.created_at < ? AND b.status != 'RETURNED'
          ORDER BY b.created_at ASC, bi.id ASC`
      )
      .all(start, end);

    const items = rows.map((r) => {
      const cost = r.quantity * r.cost_price;
      return { ...r, cost, profit: r.total - cost };
    });

    const uniqueProducts = new Set(items.map((i) => i.item_id ?? `custom:${i.name}`)).size;
    const totalQuantity = items.reduce((s, i) => s + i.quantity, 0);
    const totalRevenue = items.reduce((s, i) => s + i.total, 0);
    const totalCost = items.reduce((s, i) => s + i.cost, 0);
    const billCount = new Set(items.map((i) => i.bill_id)).size;

    return {
      items,
      totals: { uniqueProducts, totalQuantity, totalRevenue, totalCost, totalProfit: totalRevenue - totalCost, billCount },
    };
  },
};

export { nowIso };
