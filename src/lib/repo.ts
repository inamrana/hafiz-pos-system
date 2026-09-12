import { currentDb, runInTransaction } from './tenant-context';
import { generateBillNumber, generatePurchaseNumber, generateReturnNumber, shopNowParts, shopMidnightUtc, SHOP_TZ_SHIFT_SQL } from './utils';
import type {
  Item, Customer, CustomerLedgerEntry, Bill, BillItem, Supplier, Purchase, PurchaseItem,
} from './models';

// ── helpers ──────────────────────────────────────────────────────────────────
function nowIso() {
  return new Date().toISOString();
}

async function deductStock(itemId: number, qty: number) {
  const db = await currentDb();
  let remaining = qty;
  const batches = await db
    .prepare<{ id: number; quantity: number }>(
      `SELECT id, quantity FROM stock_batches WHERE item_id = ? AND quantity > 0
       ORDER BY (expiry_date IS NULL) ASC, expiry_date ASC, created_at ASC`
    )
    .all(itemId);
  for (const b of batches) {
    if (remaining <= 0) break;
    const take = Math.min(b.quantity, remaining);
    await db.prepare('UPDATE stock_batches SET quantity = quantity - ? WHERE id = ?').run(take, b.id);
    remaining -= take;
  }
  await db.prepare("UPDATE items SET quantity = quantity - ?, updated_at = datetime('now') WHERE id = ?").run(qty, itemId);
}

async function restockItem(itemId: number, qty: number, costPrice: number) {
  const db = await currentDb();
  await db.prepare("UPDATE items SET quantity = quantity + ?, updated_at = datetime('now') WHERE id = ?").run(qty, itemId);
  await db.prepare(
    'INSERT INTO stock_batches (item_id, quantity, cost_price, expiry_date, purchase_id) VALUES (?, ?, ?, NULL, NULL)'
  ).run(itemId, qty, costPrice);
}

// ── ITEMS ────────────────────────────────────────────────────────────────────
export const itemsRepo = {
  async search(q: string): Promise<Item[]> {
    const db = await currentDb();
    if (!q.trim()) {
      return db.prepare<Item>('SELECT * FROM items ORDER BY name ASC').all();
    }
    const like = `%${q}%`;
    return db
      .prepare<Item>(
        `SELECT * FROM items WHERE (name LIKE ? OR category LIKE ? OR barcode = ? OR CAST(id AS TEXT) = ?)
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
    return db.prepare<Item>('SELECT * FROM items WHERE barcode = ?').get(barcode);
  },
  async all(): Promise<Item[]> {
    const db = await currentDb();
    return db.prepare<Item>('SELECT * FROM items ORDER BY name ASC').all();
  },
  async lowStock(): Promise<Item[]> {
    const db = await currentDb();
    return db
      .prepare<Item>('SELECT * FROM items WHERE quantity <= low_stock_threshold ORDER BY quantity ASC LIMIT 50')
      .all();
  },
  async create(data: Partial<Item>): Promise<Item> {
    const db = await currentDb();
    const info = await db
      .prepare(
        `INSERT INTO items (barcode, name, category, cost_price, sale_price, quantity, unit, unit_type, low_stock_threshold)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.barcode || null,
        data.name,
        data.category || 'General',
        data.cost_price ?? 0,
        data.sale_price ?? 0,
        data.quantity ?? 0,
        data.unit || 'Pcs',
        data.unit_type || 'COUNT',
        data.low_stock_threshold ?? 5
      );
    const item = (await this.getById(info.lastInsertRowid))!;
    if ((data.quantity ?? 0) > 0) {
      await db
        .prepare('INSERT INTO stock_batches (item_id, quantity, cost_price, expiry_date) VALUES (?, ?, ?, NULL)')
        .run(item.id, data.quantity, data.cost_price ?? 0);
    }
    return item;
  },
  async update(id: number, data: Partial<Item>): Promise<Item | undefined> {
    const db = await currentDb();
    const current = await this.getById(id);
    if (!current) return undefined;
    await db
      .prepare(
        `UPDATE items SET barcode=?, name=?, category=?, cost_price=?,
         sale_price=?, quantity=?, unit=?, unit_type=?,
         low_stock_threshold=?, updated_at=datetime('now') WHERE id=?`
      )
      .run(
        data.barcode ?? current.barcode,
        data.name ?? current.name,
        data.category ?? current.category,
        data.cost_price ?? current.cost_price,
        data.sale_price ?? current.sale_price,
        data.quantity ?? current.quantity,
        data.unit ?? current.unit,
        data.unit_type ?? current.unit_type,
        data.low_stock_threshold ?? current.low_stock_threshold,
        id
      );
    return this.getById(id);
  },
  async remove(id: number) {
    const db = await currentDb();
    await db.prepare('DELETE FROM items WHERE id = ?').run(id);
  },
  async expiringBatches(withinDays: number) {
    const db = await currentDb();
    return db
      .prepare(
        `SELECT sb.*, i.name AS item_name, i.unit AS item_unit
         FROM stock_batches sb JOIN items i ON i.id = sb.item_id
         WHERE sb.quantity > 0 AND sb.expiry_date IS NOT NULL
           AND date(sb.expiry_date) <= date('now', '+' || ? || ' days')
         ORDER BY sb.expiry_date ASC LIMIT 100`
      )
      .all(withinDays);
  },
};

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
    const db = await currentDb();
    await db.prepare('UPDATE suppliers SET balance = balance - ? WHERE id = ?').run(amount, supplierId);
    await db
      .prepare('INSERT INTO supplier_ledger (supplier_id, amount, type, notes) VALUES (?, ?, ?, ?)')
      .run(supplierId, amount, 'PAYMENT', notes || '');
    return (await this.getById(supplierId))!;
  },
};

// ── PURCHASES ────────────────────────────────────────────────────────────────
interface PurchaseInput {
  supplierId: number | null;
  supplierName: string;
  paymentType: 'CASH' | 'CREDIT';
  items: { itemId: number | null; name: string; quantity: number; costPrice: number; expiryDate: string | null; salePrice?: number; category?: string; unit?: string }[];
}

export const purchasesRepo = {
  async create(input: PurchaseInput): Promise<Purchase> {
    const subtotal = input.items.reduce((s, i) => s + i.quantity * i.costPrice, 0);
    const purchaseNumber = generatePurchaseNumber();

    const purchaseId = await runInTransaction(async () => {
      const db = await currentDb();
      const info = await db
        .prepare(
          `INSERT INTO purchases (purchase_number, supplier_id, supplier_name, payment_type, subtotal, total)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(purchaseNumber, input.supplierId, input.supplierName || 'Unknown Supplier', input.paymentType, subtotal, subtotal);
      const purchaseId = info.lastInsertRowid;

      for (const line of input.items) {
        let itemId = line.itemId;
        if (!itemId) {
          // new item created on the fly during purchase
          const created = await itemsRepo.create({
            name: line.name,
            category: line.category || 'General',
            cost_price: line.costPrice,
            sale_price: line.salePrice ?? line.costPrice,
            quantity: 0,
            unit: line.unit || 'Pcs',
          });
          itemId = created.id;
        }
        const total = line.quantity * line.costPrice;
        await db
          .prepare(
            `INSERT INTO purchase_items (purchase_id, item_id, name, quantity, cost_price, expiry_date, total)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(purchaseId, itemId, line.name, line.quantity, line.costPrice, line.expiryDate || null, total);

        await db
          .prepare("UPDATE items SET quantity = quantity + ?, cost_price = ?, updated_at = datetime('now') WHERE id = ?")
          .run(line.quantity, line.costPrice, itemId);
        await db
          .prepare('INSERT INTO stock_batches (item_id, quantity, cost_price, expiry_date, purchase_id) VALUES (?, ?, ?, ?, ?)')
          .run(itemId, line.quantity, line.costPrice, line.expiryDate || null, purchaseId);
      }

      if (input.supplierId) {
        await db
          .prepare('UPDATE suppliers SET balance = balance + ? WHERE id = ?')
          .run(input.paymentType === 'CREDIT' ? subtotal : 0, input.supplierId);
        await db
          .prepare('INSERT INTO supplier_ledger (supplier_id, amount, type, notes, purchase_id) VALUES (?, ?, ?, ?, ?)')
          .run(input.supplierId, subtotal, 'PURCHASE', purchaseNumber, purchaseId);
      }

      return purchaseId;
    });

    return (await this.getById(purchaseId))!;
  },
  async getById(id: number): Promise<Purchase> {
    const db = await currentDb();
    const purchase = (await db.prepare<Purchase>('SELECT * FROM purchases WHERE id = ?').get(id))!;
    const items = await db.prepare<PurchaseItem>('SELECT * FROM purchase_items WHERE purchase_id = ?').all(id);
    return { ...purchase, items };
  },
  async list(limit = 100): Promise<Purchase[]> {
    const db = await currentDb();
    return db.prepare<Purchase>('SELECT * FROM purchases ORDER BY created_at DESC LIMIT ?').all(limit);
  },
};

// ── CUSTOMERS ────────────────────────────────────────────────────────────────
export const customersRepo = {
  async search(q: string): Promise<Customer[]> {
    const db = await currentDb();
    const rows = q.trim()
      ? await db.prepare<Customer>('SELECT * FROM customers WHERE (name LIKE ? OR phone LIKE ?) ORDER BY name ASC').all(`%${q}%`, `%${q}%`)
      : await db.prepare<Customer>('SELECT * FROM customers ORDER BY name ASC').all();
    const withLedgers: Customer[] = [];
    for (const c of rows) {
      const ledger = await db.prepare<CustomerLedgerEntry>('SELECT * FROM customer_ledger WHERE customer_id = ? ORDER BY date ASC').all(c.id);
      withLedgers.push({ ...c, ledger });
    }
    return withLedgers;
  },
  async getById(id: number): Promise<Customer | undefined> {
    const db = await currentDb();
    const c = await db.prepare<Customer>('SELECT * FROM customers WHERE id = ?').get(id);
    if (!c) return undefined;
    c.ledger = await db.prepare<CustomerLedgerEntry>('SELECT * FROM customer_ledger WHERE customer_id = ? ORDER BY date ASC').all(id);
    return c;
  },
  async create(data: { name: string; phone?: string }): Promise<Customer> {
    const db = await currentDb();
    const info = await db.prepare('INSERT INTO customers (name, phone) VALUES (?, ?)').run(data.name, data.phone || '');
    return (await this.getById(info.lastInsertRowid))!;
  },
  async logPayment(customerId: number, amount: number, notes: string): Promise<Customer> {
    const db = await currentDb();
    await db.prepare('UPDATE customers SET balance = balance - ? WHERE id = ?').run(amount, customerId);
    await db
      .prepare('INSERT INTO customer_ledger (customer_id, amount, type, notes) VALUES (?, ?, ?, ?)')
      .run(customerId, amount, 'PAYMENT', notes || '');
    return (await this.getById(customerId))!;
  },
};

// ── BILLS ────────────────────────────────────────────────────────────────────
interface BillInput {
  items: { itemId: number | null; name: string; quantity: number; price: number; total: number; costPrice?: number | null }[];
  discount: number;
  paymentType: 'CASH' | 'CARD' | 'UDHAAR';
  customerId: number | null;
  customerName: string;
}

export const billsRepo = {
  async create(input: BillInput): Promise<Bill> {
    const subtotal = input.items.reduce((s, i) => s + i.total, 0);
    const total = Math.max(0, subtotal - (input.discount || 0));
    const billNumber = generateBillNumber();

    const billId = await runInTransaction(async () => {
      const db = await currentDb();
      const info = await db
        .prepare(
          `INSERT INTO bills (bill_number, customer_id, customer_name, payment_type, subtotal, discount, total)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          billNumber,
          input.customerId,
          input.customerName || 'Walk-in Customer',
          input.paymentType,
          subtotal,
          input.discount || 0,
          total
        );
      const billId = info.lastInsertRowid;

      for (const line of input.items) {
        await db
          .prepare('INSERT INTO bill_items (bill_id, item_id, name, quantity, price, total, cost_price) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(billId, line.itemId, line.name, line.quantity, line.price, line.total, line.costPrice ?? null);
        if (line.itemId) await deductStock(line.itemId, line.quantity);
      }

      if (input.paymentType === 'UDHAAR' && input.customerId) {
        await db.prepare('UPDATE customers SET balance = balance + ? WHERE id = ?').run(total, input.customerId);
        await db
          .prepare('INSERT INTO customer_ledger (customer_id, amount, type, bill_id, notes) VALUES (?, ?, ?, ?, ?)')
          .run(input.customerId, total, 'CREDIT', billId, billNumber);
      }

      return billId;
    });

    return this.getById(billId);
  },
  async getById(id: number): Promise<Bill> {
    const db = await currentDb();
    const bill = (await db.prepare<Bill>('SELECT * FROM bills WHERE id = ?').get(id))!;
    const items = await db.prepare<BillItem>('SELECT * FROM bill_items WHERE bill_id = ?').all(id);
    return { ...bill, items };
  },
  async getByNumber(billNumber: string): Promise<Bill | undefined> {
    const db = await currentDb();
    const bill = await db.prepare<Bill>('SELECT * FROM bills WHERE bill_number = ?').get(billNumber);
    if (!bill) return undefined;
    const items = await db.prepare<BillItem>('SELECT * FROM bill_items WHERE bill_id = ?').all(bill.id);
    return { ...bill, items };
  },
  async list(opts: { limit?: number; from?: string; to?: string; type?: string } = {}): Promise<Bill[]> {
    const db = await currentDb();
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (opts.from) { clauses.push('created_at >= ?'); params.push(opts.from); }
    if (opts.to) { clauses.push('created_at <= ?'); params.push(opts.to); }
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
    if (!bill) throw new Error('Bill not found');

    return runInTransaction(async () => {
      const db = await currentDb();
      let refundAmount = 0;
      const returnNumber = generateReturnNumber();
      const returnInfo = await db
        .prepare('INSERT INTO returns (return_number, bill_id, refund_amount, refund_method, notes) VALUES (?, ?, 0, ?, ?)')
        .run(returnNumber, input.billId, input.refundMethod, input.notes || '');
      const returnId = returnInfo.lastInsertRowid;

      for (const line of input.lines) {
        const billItem = (bill.items || []).find((i) => i.id === line.billItemId);
        if (!billItem) continue;
        const remaining = billItem.quantity - billItem.returned_quantity;
        const qty = Math.min(line.quantity, remaining);
        if (qty <= 0) continue;
        const lineTotal = qty * billItem.price;
        refundAmount += lineTotal;

        await db.prepare('UPDATE bill_items SET returned_quantity = returned_quantity + ? WHERE id = ?').run(qty, billItem.id);
        await db
          .prepare('INSERT INTO return_items (return_id, bill_item_id, item_id, quantity, price, total) VALUES (?, ?, ?, ?, ?, ?)')
          .run(returnId, billItem.id, billItem.item_id, qty, billItem.price, lineTotal);
        if (billItem.item_id) await restockItem(billItem.item_id, qty, 0);
      }

      await db.prepare('UPDATE returns SET refund_amount = ? WHERE id = ?').run(refundAmount, returnId);

      const updatedItems = await db.prepare<BillItem>('SELECT * FROM bill_items WHERE bill_id = ?').all(input.billId);
      const fullyReturned = updatedItems.every((i) => i.returned_quantity >= i.quantity);
      const anyReturned = updatedItems.some((i) => i.returned_quantity > 0);
      const status = fullyReturned ? 'RETURNED' : anyReturned ? 'PARTIAL_RETURN' : 'COMPLETED';
      await db.prepare('UPDATE bills SET status = ? WHERE id = ?').run(status, input.billId);

      if (input.refundMethod === 'UDHAAR_ADJUST' && bill.customer_id) {
        await db.prepare('UPDATE customers SET balance = balance - ? WHERE id = ?').run(refundAmount, bill.customer_id);
        await db
          .prepare('INSERT INTO customer_ledger (customer_id, amount, type, bill_id, notes) VALUES (?, ?, ?, ?, ?)')
          .run(bill.customer_id, refundAmount, 'PAYMENT', input.billId, `Return ${returnNumber}`);
      }

      return returnId;
    });
  },
};

// ── SETTINGS ─────────────────────────────────────────────────────────────────
export const settingsRepo = {
  async getAll(): Promise<Record<string, string>> {
    const db = await currentDb();
    const rows = await db.prepare<{ key: string; value: string }>('SELECT key, value FROM settings').all();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  },
  async update(values: Record<string, string>) {
    const db = await currentDb();
    const upsert = db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    );
    for (const [k, v] of Object.entries(values)) {
      await upsert.run(k, String(v));
    }
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
    const bills = await db
      .prepare<DailyBillRow>(
        `SELECT b.id, b.bill_number, b.created_at, b.customer_name, b.payment_type, b.status, b.total,
                (SELECT COUNT(*) FROM bill_items bi WHERE bi.bill_id = b.id) AS item_count,
                (SELECT COALESCE(SUM(bi.quantity * COALESCE(bi.cost_price, i.cost_price, 0)), 0)
                   FROM bill_items bi LEFT JOIN items i ON i.id = bi.item_id
                  WHERE bi.bill_id = b.id) AS cost
           FROM bills b
          WHERE date(datetime(b.created_at, ${SHOP_TZ_SHIFT_SQL})) = date(?) AND b.status != 'RETURNED'
          ORDER BY b.created_at ASC`
      )
      .all(date);

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
      .all(start.toISOString());

    const costRows = await db
      .prepare<{ month: string; cost: number }>(
        `SELECT strftime('%Y-%m', datetime(b.created_at, ${SHOP_TZ_SHIFT_SQL})) AS month, COALESCE(SUM(bi.quantity * COALESCE(bi.cost_price, i.cost_price, 0)), 0) AS cost
           FROM bill_items bi JOIN bills b ON b.id = bi.bill_id LEFT JOIN items i ON i.id = bi.item_id
          WHERE b.status != 'RETURNED' AND b.created_at >= ?
          GROUP BY month`
      )
      .all(start.toISOString());

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
      .all(start.toISOString());

    const costRows = await db
      .prepare<{ year: string; cost: number }>(
        `SELECT strftime('%Y', datetime(b.created_at, ${SHOP_TZ_SHIFT_SQL})) AS year, COALESCE(SUM(bi.quantity * COALESCE(bi.cost_price, i.cost_price, 0)), 0) AS cost
           FROM bill_items bi JOIN bills b ON b.id = bi.bill_id LEFT JOIN items i ON i.id = bi.item_id
          WHERE b.status != 'RETURNED' AND b.created_at >= ?
          GROUP BY year`
      )
      .all(start.toISOString());

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
           FROM items`
      )
      .get())!;

    const lowStock = (await db.prepare<{ c: number }>('SELECT COUNT(*) AS c FROM items WHERE quantity > 0 AND quantity <= low_stock_threshold').get())!;
    const outOfStock = (await db.prepare<{ c: number }>('SELECT COUNT(*) AS c FROM items WHERE quantity <= 0').get())!;

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
    if (opts.from) { clauses.push('b.created_at >= ?'); params.push(opts.from); }
    if (opts.to) { clauses.push('b.created_at <= ?'); params.push(opts.to); }
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
};

export { nowIso };
