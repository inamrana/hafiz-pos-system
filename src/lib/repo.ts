import { currentDb } from './tenant-context';
import bcrypt from 'bcryptjs';
import { generateBillNumber, generatePurchaseNumber, generateReturnNumber } from './utils';
import type {
  Item, Customer, Bill, BillItem, Supplier, Purchase, PurchaseItem, PublicUser, User,
} from './models';

// ── helpers ──────────────────────────────────────────────────────────────────
function nowIso() {
  return new Date().toISOString();
}

function deductStock(itemId: number, qty: number) {
  const db = currentDb();
  let remaining = qty;
  const batches = db
    .prepare(
      `SELECT * FROM stock_batches WHERE item_id = ? AND quantity > 0
       ORDER BY (expiry_date IS NULL) ASC, expiry_date ASC, created_at ASC`
    )
    .all(itemId) as { id: number; quantity: number }[];
  for (const b of batches) {
    if (remaining <= 0) break;
    const take = Math.min(b.quantity, remaining);
    db.prepare('UPDATE stock_batches SET quantity = quantity - ? WHERE id = ?').run(take, b.id);
    remaining -= take;
  }
  db.prepare("UPDATE items SET quantity = quantity - ?, updated_at = datetime('now') WHERE id = ?").run(qty, itemId);
}

function restockItem(itemId: number, qty: number, costPrice: number) {
  const db = currentDb();
  db.prepare("UPDATE items SET quantity = quantity + ?, updated_at = datetime('now') WHERE id = ?").run(qty, itemId);
  db.prepare(
    'INSERT INTO stock_batches (item_id, quantity, cost_price, expiry_date, purchase_id) VALUES (?, ?, ?, NULL, NULL)'
  ).run(itemId, qty, costPrice);
}

// ── ITEMS ────────────────────────────────────────────────────────────────────
export const itemsRepo = {
  search(q: string): Item[] {
    const db = currentDb();
    if (!q.trim()) {
      return db.prepare('SELECT * FROM items ORDER BY name ASC LIMIT 200').all() as Item[];
    }
    const like = `%${q}%`;
    return db
      .prepare(
        `SELECT * FROM items WHERE name LIKE ? OR category LIKE ? OR barcode = ? OR CAST(id AS TEXT) = ?
         ORDER BY name ASC LIMIT 50`
      )
      .all(like, like, q, q) as Item[];
  },
  getById(id: number): Item | undefined {
    return currentDb().prepare('SELECT * FROM items WHERE id = ?').get(id) as Item | undefined;
  },
  getByBarcode(barcode: string): Item | undefined {
    return currentDb().prepare('SELECT * FROM items WHERE barcode = ?').get(barcode) as Item | undefined;
  },
  all(): Item[] {
    return currentDb().prepare('SELECT * FROM items ORDER BY name ASC').all() as Item[];
  },
  lowStock(): Item[] {
    return currentDb()
      .prepare('SELECT * FROM items WHERE quantity <= low_stock_threshold ORDER BY quantity ASC LIMIT 50')
      .all() as Item[];
  },
  create(data: Partial<Item>): Item {
    const db = currentDb();
    const info = db
      .prepare(
        `INSERT INTO items (barcode, name, category, cost_price, sale_price, quantity, unit, unit_type, low_stock_threshold)
         VALUES (@barcode, @name, @category, @cost_price, @sale_price, @quantity, @unit, @unit_type, @low_stock_threshold)`
      )
      .run({
        barcode: data.barcode || null,
        name: data.name,
        category: data.category || 'General',
        cost_price: data.cost_price ?? 0,
        sale_price: data.sale_price ?? 0,
        quantity: data.quantity ?? 0,
        unit: data.unit || 'Pcs',
        unit_type: data.unit_type || 'COUNT',
        low_stock_threshold: data.low_stock_threshold ?? 5,
      });
    const item = this.getById(info.lastInsertRowid as number)!;
    if ((data.quantity ?? 0) > 0) {
      db.prepare('INSERT INTO stock_batches (item_id, quantity, cost_price, expiry_date) VALUES (?, ?, ?, NULL)').run(
        item.id,
        data.quantity,
        data.cost_price ?? 0
      );
    }
    return item;
  },
  update(id: number, data: Partial<Item>): Item | undefined {
    const db = currentDb();
    const current = this.getById(id);
    if (!current) return undefined;
    db.prepare(
      `UPDATE items SET barcode=@barcode, name=@name, category=@category, cost_price=@cost_price,
       sale_price=@sale_price, quantity=@quantity, unit=@unit, unit_type=@unit_type,
       low_stock_threshold=@low_stock_threshold, updated_at=datetime('now') WHERE id=@id`
    ).run({
      id,
      barcode: data.barcode ?? current.barcode,
      name: data.name ?? current.name,
      category: data.category ?? current.category,
      cost_price: data.cost_price ?? current.cost_price,
      sale_price: data.sale_price ?? current.sale_price,
      quantity: data.quantity ?? current.quantity,
      unit: data.unit ?? current.unit,
      unit_type: data.unit_type ?? current.unit_type,
      low_stock_threshold: data.low_stock_threshold ?? current.low_stock_threshold,
    });
    return this.getById(id);
  },
  remove(id: number) {
    currentDb().prepare('DELETE FROM items WHERE id = ?').run(id);
  },
  expiringBatches(withinDays: number) {
    return currentDb()
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
  search(q: string): Supplier[] {
    const db = currentDb();
    if (!q.trim()) return db.prepare('SELECT * FROM suppliers ORDER BY name ASC').all() as Supplier[];
    return db.prepare('SELECT * FROM suppliers WHERE name LIKE ? ORDER BY name ASC').all(`%${q}%`) as Supplier[];
  },
  getById(id: number): Supplier | undefined {
    return currentDb().prepare('SELECT * FROM suppliers WHERE id = ?').get(id) as Supplier | undefined;
  },
  create(data: { name: string; phone?: string; address?: string }): Supplier {
    const db = currentDb();
    const info = db
      .prepare('INSERT INTO suppliers (name, phone, address) VALUES (?, ?, ?)')
      .run(data.name, data.phone || '', data.address || '');
    return this.getById(info.lastInsertRowid as number)!;
  },
  ledger(id: number) {
    return currentDb().prepare('SELECT * FROM supplier_ledger WHERE supplier_id = ? ORDER BY date DESC').all(id);
  },
  logPayment(supplierId: number, amount: number, notes: string): Supplier {
    const db = currentDb();
    db.prepare('UPDATE suppliers SET balance = balance - ? WHERE id = ?').run(amount, supplierId);
    db.prepare('INSERT INTO supplier_ledger (supplier_id, amount, type, notes) VALUES (?, ?, ?, ?)').run(
      supplierId,
      amount,
      'PAYMENT',
      notes || ''
    );
    return this.getById(supplierId)!;
  },
};

// ── PURCHASES ────────────────────────────────────────────────────────────────
interface PurchaseInput {
  supplierId: number | null;
  supplierName: string;
  paymentType: 'CASH' | 'CREDIT';
  createdBy: number | null;
  items: { itemId: number | null; name: string; quantity: number; costPrice: number; expiryDate: string | null; salePrice?: number; category?: string; unit?: string }[];
}

export const purchasesRepo = {
  create(input: PurchaseInput): Purchase {
    const db = currentDb();
    const subtotal = input.items.reduce((s, i) => s + i.quantity * i.costPrice, 0);
    const purchaseNumber = generatePurchaseNumber();

    const tx = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO purchases (purchase_number, supplier_id, supplier_name, payment_type, subtotal, total, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(purchaseNumber, input.supplierId, input.supplierName || 'Unknown Supplier', input.paymentType, subtotal, subtotal, input.createdBy);
      const purchaseId = info.lastInsertRowid as number;

      for (const line of input.items) {
        let itemId = line.itemId;
        if (!itemId) {
          // new item created on the fly during purchase
          const created = itemsRepo.create({
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
        db.prepare(
          `INSERT INTO purchase_items (purchase_id, item_id, name, quantity, cost_price, expiry_date, total)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(purchaseId, itemId, line.name, line.quantity, line.costPrice, line.expiryDate || null, total);

        db.prepare("UPDATE items SET quantity = quantity + ?, cost_price = ?, updated_at = datetime('now') WHERE id = ?").run(
          line.quantity,
          line.costPrice,
          itemId
        );
        db.prepare(
          'INSERT INTO stock_batches (item_id, quantity, cost_price, expiry_date, purchase_id) VALUES (?, ?, ?, ?, ?)'
        ).run(itemId, line.quantity, line.costPrice, line.expiryDate || null, purchaseId);
      }

      if (input.supplierId) {
        db.prepare('UPDATE suppliers SET balance = balance + ? WHERE id = ?').run(
          input.paymentType === 'CREDIT' ? subtotal : 0,
          input.supplierId
        );
        db.prepare(
          'INSERT INTO supplier_ledger (supplier_id, amount, type, notes, purchase_id) VALUES (?, ?, ?, ?, ?)'
        ).run(input.supplierId, subtotal, 'PURCHASE', purchaseNumber, purchaseId);
      }

      return purchaseId;
    });

    const purchaseId = tx();
    return this.getById(purchaseId)!;
  },
  getById(id: number): Purchase {
    const db = currentDb();
    const purchase = db.prepare('SELECT * FROM purchases WHERE id = ?').get(id) as Purchase;
    const items = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(id) as PurchaseItem[];
    return { ...purchase, items };
  },
  list(limit = 100): Purchase[] {
    return currentDb().prepare('SELECT * FROM purchases ORDER BY created_at DESC LIMIT ?').all(limit) as Purchase[];
  },
};

// ── CUSTOMERS ────────────────────────────────────────────────────────────────
export const customersRepo = {
  search(q: string): Customer[] {
    const db = currentDb();
    const rows = (
      q.trim()
        ? (db.prepare('SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? ORDER BY name ASC').all(`%${q}%`, `%${q}%`) as Customer[])
        : (db.prepare('SELECT * FROM customers ORDER BY name ASC').all() as Customer[])
    );
    return rows.map((c) => ({ ...c, ledger: db.prepare('SELECT * FROM customer_ledger WHERE customer_id = ? ORDER BY date ASC').all(c.id) as Customer['ledger'] }));
  },
  getById(id: number): Customer | undefined {
    const db = currentDb();
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as Customer | undefined;
    if (!c) return undefined;
    c.ledger = db.prepare('SELECT * FROM customer_ledger WHERE customer_id = ? ORDER BY date ASC').all(id) as Customer['ledger'];
    return c;
  },
  create(data: { name: string; phone?: string }): Customer {
    const db = currentDb();
    const info = db.prepare('INSERT INTO customers (name, phone) VALUES (?, ?)').run(data.name, data.phone || '');
    return this.getById(info.lastInsertRowid as number)!;
  },
  logPayment(customerId: number, amount: number, notes: string): Customer {
    const db = currentDb();
    db.prepare('UPDATE customers SET balance = balance - ? WHERE id = ?').run(amount, customerId);
    db.prepare('INSERT INTO customer_ledger (customer_id, amount, type, notes) VALUES (?, ?, ?, ?)').run(
      customerId,
      amount,
      'PAYMENT',
      notes || ''
    );
    return this.getById(customerId)!;
  },
};

// ── BILLS ────────────────────────────────────────────────────────────────────
interface BillInput {
  items: { itemId: number | null; name: string; quantity: number; price: number; total: number }[];
  discount: number;
  paymentType: 'CASH' | 'CARD' | 'UDHAAR';
  customerId: number | null;
  customerName: string;
  cashierId: number | null;
  cashierName: string;
}

export const billsRepo = {
  create(input: BillInput): Bill {
    const db = currentDb();
    const subtotal = input.items.reduce((s, i) => s + i.total, 0);
    const total = Math.max(0, subtotal - (input.discount || 0));
    const billNumber = generateBillNumber();

    const tx = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO bills (bill_number, customer_id, customer_name, payment_type, subtotal, discount, total, cashier_id, cashier_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          billNumber,
          input.customerId,
          input.customerName || 'Walk-in Customer',
          input.paymentType,
          subtotal,
          input.discount || 0,
          total,
          input.cashierId,
          input.cashierName || ''
        );
      const billId = info.lastInsertRowid as number;

      for (const line of input.items) {
        db.prepare('INSERT INTO bill_items (bill_id, item_id, name, quantity, price, total) VALUES (?, ?, ?, ?, ?, ?)').run(
          billId,
          line.itemId,
          line.name,
          line.quantity,
          line.price,
          line.total
        );
        if (line.itemId) deductStock(line.itemId, line.quantity);
      }

      if (input.paymentType === 'UDHAAR' && input.customerId) {
        db.prepare('UPDATE customers SET balance = balance + ? WHERE id = ?').run(total, input.customerId);
        db.prepare('INSERT INTO customer_ledger (customer_id, amount, type, bill_id, notes) VALUES (?, ?, ?, ?, ?)').run(
          input.customerId,
          total,
          'CREDIT',
          billId,
          billNumber
        );
      }

      return billId;
    });

    return this.getById(tx());
  },
  getById(id: number): Bill {
    const db = currentDb();
    const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(id) as Bill;
    const items = db.prepare('SELECT * FROM bill_items WHERE bill_id = ?').all(id) as BillItem[];
    return { ...bill, items };
  },
  getByNumber(billNumber: string): Bill | undefined {
    const db = currentDb();
    const bill = db.prepare('SELECT * FROM bills WHERE bill_number = ?').get(billNumber) as Bill | undefined;
    if (!bill) return undefined;
    const items = db.prepare('SELECT * FROM bill_items WHERE bill_id = ?').all(bill.id) as BillItem[];
    return { ...bill, items };
  },
  list(opts: { limit?: number; from?: string; to?: string; type?: string } = {}): Bill[] {
    const db = currentDb();
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (opts.from) { clauses.push('created_at >= ?'); params.push(opts.from); }
    if (opts.to) { clauses.push('created_at <= ?'); params.push(opts.to); }
    if (opts.type && opts.type !== 'ALL') { clauses.push('payment_type = ?'); params.push(opts.type); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db
      .prepare(`SELECT * FROM bills ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...params, opts.limit || 200) as Bill[];
    return rows;
  },
};

// ── RETURNS ──────────────────────────────────────────────────────────────────
interface ReturnInput {
  billId: number;
  lines: { billItemId: number; quantity: number }[];
  refundMethod: 'CASH' | 'UDHAAR_ADJUST';
  notes: string;
  cashierId: number | null;
}

export const returnsRepo = {
  create(input: ReturnInput) {
    const db = currentDb();
    const bill = billsRepo.getById(input.billId);
    if (!bill) throw new Error('Bill not found');

    const tx = db.transaction(() => {
      let refundAmount = 0;
      const returnNumber = generateReturnNumber();
      const returnInfo = db
        .prepare('INSERT INTO returns (return_number, bill_id, refund_amount, refund_method, notes, cashier_id) VALUES (?, ?, 0, ?, ?, ?)')
        .run(returnNumber, input.billId, input.refundMethod, input.notes || '', input.cashierId);
      const returnId = returnInfo.lastInsertRowid as number;

      for (const line of input.lines) {
        const billItem = (bill.items || []).find((i) => i.id === line.billItemId);
        if (!billItem) continue;
        const remaining = billItem.quantity - billItem.returned_quantity;
        const qty = Math.min(line.quantity, remaining);
        if (qty <= 0) continue;
        const lineTotal = qty * billItem.price;
        refundAmount += lineTotal;

        db.prepare('UPDATE bill_items SET returned_quantity = returned_quantity + ? WHERE id = ?').run(qty, billItem.id);
        db.prepare('INSERT INTO return_items (return_id, bill_item_id, item_id, quantity, price, total) VALUES (?, ?, ?, ?, ?, ?)').run(
          returnId,
          billItem.id,
          billItem.item_id,
          qty,
          billItem.price,
          lineTotal
        );
        if (billItem.item_id) restockItem(billItem.item_id, qty, 0);
      }

      db.prepare('UPDATE returns SET refund_amount = ? WHERE id = ?').run(refundAmount, returnId);

      const updatedItems = db.prepare('SELECT * FROM bill_items WHERE bill_id = ?').all(input.billId) as BillItem[];
      const fullyReturned = updatedItems.every((i) => i.returned_quantity >= i.quantity);
      const anyReturned = updatedItems.some((i) => i.returned_quantity > 0);
      const status = fullyReturned ? 'RETURNED' : anyReturned ? 'PARTIAL_RETURN' : 'COMPLETED';
      db.prepare('UPDATE bills SET status = ? WHERE id = ?').run(status, input.billId);

      if (input.refundMethod === 'UDHAAR_ADJUST' && bill.customer_id) {
        db.prepare('UPDATE customers SET balance = balance - ? WHERE id = ?').run(refundAmount, bill.customer_id);
        db.prepare('INSERT INTO customer_ledger (customer_id, amount, type, bill_id, notes) VALUES (?, ?, ?, ?, ?)').run(
          bill.customer_id,
          refundAmount,
          'PAYMENT',
          input.billId,
          `Return ${returnNumber}`
        );
      }

      return returnId;
    });

    return tx();
  },
};

// ── USERS / AUTH ─────────────────────────────────────────────────────────────
function toPublicUser(u: User): PublicUser {
  const { password_hash, ...rest } = u;
  void password_hash;
  return rest;
}

export const usersRepo = {
  list(): PublicUser[] {
    return (currentDb().prepare('SELECT * FROM users ORDER BY name ASC').all() as User[]).map(toPublicUser);
  },
  getById(id: number): PublicUser | undefined {
    const u = currentDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
    return u ? toPublicUser(u) : undefined;
  },
  authenticate(username: string, password: string): PublicUser | null {
    const u = currentDb().prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username) as User | undefined;
    if (!u) return null;
    if (!bcrypt.compareSync(password, u.password_hash)) return null;
    return toPublicUser(u);
  },
  create(data: { username: string; password: string; name: string; role: 'ADMIN' | 'CASHIER' }): PublicUser {
    const db = currentDb();
    const hash = bcrypt.hashSync(data.password, 10);
    const info = db
      .prepare('INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)')
      .run(data.username, hash, data.name, data.role);
    return this.getById(info.lastInsertRowid as number)!;
  },
  setActive(id: number, active: boolean) {
    currentDb().prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  },
  resetPassword(id: number, password: string) {
    const hash = bcrypt.hashSync(password, 10);
    currentDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
  },
};

// ── SETTINGS ─────────────────────────────────────────────────────────────────
export const settingsRepo = {
  getAll(): Record<string, string> {
    const rows = currentDb().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  },
  update(values: Record<string, string>) {
    const db = currentDb();
    const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    const tx = db.transaction(() => {
      for (const [k, v] of Object.entries(values)) upsert.run(k, String(v));
    });
    tx();
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
  daily(date: string) {
    const db = currentDb();
    const bills = db
      .prepare(
        `SELECT b.id, b.bill_number, b.created_at, b.customer_name, b.payment_type, b.status, b.total,
                (SELECT COUNT(*) FROM bill_items bi WHERE bi.bill_id = b.id) AS item_count,
                (SELECT COALESCE(SUM(bi.quantity * COALESCE(i.cost_price, 0)), 0)
                   FROM bill_items bi LEFT JOIN items i ON i.id = bi.item_id
                  WHERE bi.bill_id = b.id) AS cost
           FROM bills b
          WHERE date(b.created_at) = date(?) AND b.status != 'RETURNED'
          ORDER BY b.created_at ASC`
      )
      .all(date) as DailyBillRow[];

    const totalSales = bills.reduce((s, b) => s + b.total, 0);
    const totalCost = bills.reduce((s, b) => s + b.cost, 0);
    return {
      bills: bills.map((b) => ({ ...b, profit: b.total - b.cost })),
      totals: { billCount: bills.length, totalSales, totalCost, netProfit: totalSales - totalCost },
    };
  },

  /** Sales/cost/profit grouped by month for the last `months` months (default 12), oldest first. */
  monthly(months = 12) {
    const db = currentDb();
    const start = new Date();
    start.setMonth(start.getMonth() - (months - 1));
    start.setDate(1);
    start.setHours(0, 0, 0, 0);

    const salesRows = db
      .prepare(
        `SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS count, COALESCE(SUM(total), 0) AS total
           FROM bills WHERE status != 'RETURNED' AND created_at >= ?
          GROUP BY month`
      )
      .all(start.toISOString()) as { month: string; count: number; total: number }[];

    const costRows = db
      .prepare(
        `SELECT strftime('%Y-%m', b.created_at) AS month, COALESCE(SUM(bi.quantity * COALESCE(i.cost_price, 0)), 0) AS cost
           FROM bill_items bi JOIN bills b ON b.id = bi.bill_id LEFT JOIN items i ON i.id = bi.item_id
          WHERE b.status != 'RETURNED' AND b.created_at >= ?
          GROUP BY month`
      )
      .all(start.toISOString()) as { month: string; cost: number }[];

    const salesMap = new Map(salesRows.map((r) => [r.month, r]));
    const costMap = new Map(costRows.map((r) => [r.month, r.cost]));

    const rows = [];
    for (let i = 0; i < months; i++) {
      const d = new Date(start);
      d.setMonth(d.getMonth() + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const sales = salesMap.get(key);
      const total = sales?.total || 0;
      const cost = costMap.get(key) || 0;
      rows.push({
        month: key,
        label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
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
  yearly(years = 5) {
    const db = currentDb();
    const startYear = new Date().getFullYear() - (years - 1);
    const start = new Date(startYear, 0, 1);

    const salesRows = db
      .prepare(
        `SELECT strftime('%Y', created_at) AS year, COUNT(*) AS count, COALESCE(SUM(total), 0) AS total
           FROM bills WHERE status != 'RETURNED' AND created_at >= ?
          GROUP BY year`
      )
      .all(start.toISOString()) as { year: string; count: number; total: number }[];

    const costRows = db
      .prepare(
        `SELECT strftime('%Y', b.created_at) AS year, COALESCE(SUM(bi.quantity * COALESCE(i.cost_price, 0)), 0) AS cost
           FROM bill_items bi JOIN bills b ON b.id = bi.bill_id LEFT JOIN items i ON i.id = bi.item_id
          WHERE b.status != 'RETURNED' AND b.created_at >= ?
          GROUP BY year`
      )
      .all(start.toISOString()) as { year: string; cost: number }[];

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
  inventory() {
    const db = currentDb();
    const byCategory = db
      .prepare(
        `SELECT category,
                COUNT(*) AS itemCount,
                COALESCE(SUM(quantity), 0) AS totalQty,
                COALESCE(SUM(quantity * cost_price), 0) AS costValue,
                COALESCE(SUM(quantity * sale_price), 0) AS saleValue
           FROM items
          GROUP BY category
          ORDER BY category ASC`
      )
      .all() as { category: string; itemCount: number; totalQty: number; costValue: number; saleValue: number }[];

    const totals = db
      .prepare(
        `SELECT COUNT(*) AS totalItems,
                COALESCE(SUM(quantity), 0) AS totalQty,
                COALESCE(SUM(quantity * cost_price), 0) AS totalCostValue,
                COALESCE(SUM(quantity * sale_price), 0) AS totalSaleValue
           FROM items`
      )
      .get() as { totalItems: number; totalQty: number; totalCostValue: number; totalSaleValue: number };

    const lowStock = db.prepare('SELECT COUNT(*) AS c FROM items WHERE quantity > 0 AND quantity <= low_stock_threshold').get() as { c: number };
    const outOfStock = db.prepare('SELECT COUNT(*) AS c FROM items WHERE quantity <= 0').get() as { c: number };

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
};

export { nowIso };
