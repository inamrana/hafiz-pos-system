import { currentDb, currentShopId, runInTransaction } from './tenant-context';
import bcrypt from 'bcryptjs';
import { generateBillNumber, generatePurchaseNumber, generateReturnNumber } from './utils';
import type {
  Item, Customer, CustomerLedgerEntry, Bill, BillItem, Supplier, Purchase, PurchaseItem, PublicUser, User,
} from './models';

// ── helpers ──────────────────────────────────────────────────────────────────
function nowIso() {
  return new Date().toISOString();
}

async function deductStock(itemId: number, qty: number) {
  const db = await currentDb();
  const shopId = currentShopId();
  let remaining = qty;
  const batches = await db
    .prepare<{ id: number; quantity: number }>(
      `SELECT id, quantity FROM stock_batches WHERE shop_id = ? AND item_id = ? AND quantity > 0
       ORDER BY (expiry_date IS NULL) ASC, expiry_date ASC, created_at ASC`
    )
    .all(shopId, itemId);
  for (const b of batches) {
    if (remaining <= 0) break;
    const take = Math.min(b.quantity, remaining);
    await db.prepare('UPDATE stock_batches SET quantity = quantity - ? WHERE id = ? AND shop_id = ?').run(take, b.id, shopId);
    remaining -= take;
  }
  await db.prepare("UPDATE items SET quantity = quantity - ?, updated_at = datetime('now') WHERE id = ? AND shop_id = ?").run(qty, itemId, shopId);
}

async function restockItem(itemId: number, qty: number, costPrice: number) {
  const db = await currentDb();
  const shopId = currentShopId();
  await db.prepare("UPDATE items SET quantity = quantity + ?, updated_at = datetime('now') WHERE id = ? AND shop_id = ?").run(qty, itemId, shopId);
  await db.prepare(
    'INSERT INTO stock_batches (shop_id, item_id, quantity, cost_price, expiry_date, purchase_id) VALUES (?, ?, ?, ?, NULL, NULL)'
  ).run(shopId, itemId, qty, costPrice);
}

// ── ITEMS ────────────────────────────────────────────────────────────────────
export const itemsRepo = {
  async search(q: string): Promise<Item[]> {
    const db = await currentDb();
    const shopId = currentShopId();
    if (!q.trim()) {
      return db.prepare<Item>('SELECT * FROM items WHERE shop_id = ? ORDER BY name ASC LIMIT 200').all(shopId);
    }
    const like = `%${q}%`;
    return db
      .prepare<Item>(
        `SELECT * FROM items WHERE shop_id = ? AND (name LIKE ? OR category LIKE ? OR barcode = ? OR CAST(id AS TEXT) = ?)
         ORDER BY name ASC LIMIT 50`
      )
      .all(shopId, like, like, q, q);
  },
  async getById(id: number): Promise<Item | undefined> {
    const db = await currentDb();
    return db.prepare<Item>('SELECT * FROM items WHERE id = ? AND shop_id = ?').get(id, currentShopId());
  },
  async getByBarcode(barcode: string): Promise<Item | undefined> {
    const db = await currentDb();
    return db.prepare<Item>('SELECT * FROM items WHERE barcode = ? AND shop_id = ?').get(barcode, currentShopId());
  },
  async all(): Promise<Item[]> {
    const db = await currentDb();
    return db.prepare<Item>('SELECT * FROM items WHERE shop_id = ? ORDER BY name ASC').all(currentShopId());
  },
  async lowStock(): Promise<Item[]> {
    const db = await currentDb();
    return db
      .prepare<Item>('SELECT * FROM items WHERE shop_id = ? AND quantity <= low_stock_threshold ORDER BY quantity ASC LIMIT 50')
      .all(currentShopId());
  },
  async create(data: Partial<Item>): Promise<Item> {
    const db = await currentDb();
    const shopId = currentShopId();
    const info = await db
      .prepare(
        `INSERT INTO items (shop_id, barcode, name, category, cost_price, sale_price, quantity, unit, unit_type, low_stock_threshold)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        shopId,
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
        .prepare('INSERT INTO stock_batches (shop_id, item_id, quantity, cost_price, expiry_date) VALUES (?, ?, ?, ?, NULL)')
        .run(shopId, item.id, data.quantity, data.cost_price ?? 0);
    }
    return item;
  },
  async update(id: number, data: Partial<Item>): Promise<Item | undefined> {
    const db = await currentDb();
    const shopId = currentShopId();
    const current = await this.getById(id);
    if (!current) return undefined;
    await db
      .prepare(
        `UPDATE items SET barcode=?, name=?, category=?, cost_price=?,
         sale_price=?, quantity=?, unit=?, unit_type=?,
         low_stock_threshold=?, updated_at=datetime('now') WHERE id=? AND shop_id=?`
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
        id,
        shopId
      );
    return this.getById(id);
  },
  async remove(id: number) {
    const db = await currentDb();
    await db.prepare('DELETE FROM items WHERE id = ? AND shop_id = ?').run(id, currentShopId());
  },
  async expiringBatches(withinDays: number) {
    const db = await currentDb();
    return db
      .prepare(
        `SELECT sb.*, i.name AS item_name, i.unit AS item_unit
         FROM stock_batches sb JOIN items i ON i.id = sb.item_id
         WHERE sb.shop_id = ? AND sb.quantity > 0 AND sb.expiry_date IS NOT NULL
           AND date(sb.expiry_date) <= date('now', '+' || ? || ' days')
         ORDER BY sb.expiry_date ASC LIMIT 100`
      )
      .all(currentShopId(), withinDays);
  },
};

// ── SUPPLIERS ────────────────────────────────────────────────────────────────
export const suppliersRepo = {
  async search(q: string): Promise<Supplier[]> {
    const db = await currentDb();
    const shopId = currentShopId();
    if (!q.trim()) return db.prepare<Supplier>('SELECT * FROM suppliers WHERE shop_id = ? ORDER BY name ASC').all(shopId);
    return db.prepare<Supplier>('SELECT * FROM suppliers WHERE shop_id = ? AND name LIKE ? ORDER BY name ASC').all(shopId, `%${q}%`);
  },
  async getById(id: number): Promise<Supplier | undefined> {
    const db = await currentDb();
    return db.prepare<Supplier>('SELECT * FROM suppliers WHERE id = ? AND shop_id = ?').get(id, currentShopId());
  },
  async create(data: { name: string; phone?: string; address?: string }): Promise<Supplier> {
    const db = await currentDb();
    const shopId = currentShopId();
    const info = await db
      .prepare('INSERT INTO suppliers (shop_id, name, phone, address) VALUES (?, ?, ?, ?)')
      .run(shopId, data.name, data.phone || '', data.address || '');
    return (await this.getById(info.lastInsertRowid))!;
  },
  async ledger(id: number) {
    const db = await currentDb();
    return db.prepare('SELECT * FROM supplier_ledger WHERE shop_id = ? AND supplier_id = ? ORDER BY date DESC').all(currentShopId(), id);
  },
  async logPayment(supplierId: number, amount: number, notes: string): Promise<Supplier> {
    const db = await currentDb();
    const shopId = currentShopId();
    await db.prepare('UPDATE suppliers SET balance = balance - ? WHERE id = ? AND shop_id = ?').run(amount, supplierId, shopId);
    await db
      .prepare('INSERT INTO supplier_ledger (shop_id, supplier_id, amount, type, notes) VALUES (?, ?, ?, ?, ?)')
      .run(shopId, supplierId, amount, 'PAYMENT', notes || '');
    return (await this.getById(supplierId))!;
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
  async create(input: PurchaseInput): Promise<Purchase> {
    const subtotal = input.items.reduce((s, i) => s + i.quantity * i.costPrice, 0);
    const purchaseNumber = generatePurchaseNumber();

    const purchaseId = await runInTransaction(async () => {
      const db = await currentDb();
      const shopId = currentShopId();
      const info = await db
        .prepare(
          `INSERT INTO purchases (shop_id, purchase_number, supplier_id, supplier_name, payment_type, subtotal, total, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(shopId, purchaseNumber, input.supplierId, input.supplierName || 'Unknown Supplier', input.paymentType, subtotal, subtotal, input.createdBy);
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
            `INSERT INTO purchase_items (shop_id, purchase_id, item_id, name, quantity, cost_price, expiry_date, total)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(shopId, purchaseId, itemId, line.name, line.quantity, line.costPrice, line.expiryDate || null, total);

        await db
          .prepare("UPDATE items SET quantity = quantity + ?, cost_price = ?, updated_at = datetime('now') WHERE id = ? AND shop_id = ?")
          .run(line.quantity, line.costPrice, itemId, shopId);
        await db
          .prepare('INSERT INTO stock_batches (shop_id, item_id, quantity, cost_price, expiry_date, purchase_id) VALUES (?, ?, ?, ?, ?, ?)')
          .run(shopId, itemId, line.quantity, line.costPrice, line.expiryDate || null, purchaseId);
      }

      if (input.supplierId) {
        await db
          .prepare('UPDATE suppliers SET balance = balance + ? WHERE id = ? AND shop_id = ?')
          .run(input.paymentType === 'CREDIT' ? subtotal : 0, input.supplierId, shopId);
        await db
          .prepare('INSERT INTO supplier_ledger (shop_id, supplier_id, amount, type, notes, purchase_id) VALUES (?, ?, ?, ?, ?, ?)')
          .run(shopId, input.supplierId, subtotal, 'PURCHASE', purchaseNumber, purchaseId);
      }

      return purchaseId;
    });

    return (await this.getById(purchaseId))!;
  },
  async getById(id: number): Promise<Purchase> {
    const db = await currentDb();
    const shopId = currentShopId();
    const purchase = (await db.prepare<Purchase>('SELECT * FROM purchases WHERE id = ? AND shop_id = ?').get(id, shopId))!;
    const items = await db.prepare<PurchaseItem>('SELECT * FROM purchase_items WHERE purchase_id = ? AND shop_id = ?').all(id, shopId);
    return { ...purchase, items };
  },
  async list(limit = 100): Promise<Purchase[]> {
    const db = await currentDb();
    return db.prepare<Purchase>('SELECT * FROM purchases WHERE shop_id = ? ORDER BY created_at DESC LIMIT ?').all(currentShopId(), limit);
  },
};

// ── CUSTOMERS ────────────────────────────────────────────────────────────────
export const customersRepo = {
  async search(q: string): Promise<Customer[]> {
    const db = await currentDb();
    const shopId = currentShopId();
    const rows = q.trim()
      ? await db.prepare<Customer>('SELECT * FROM customers WHERE shop_id = ? AND (name LIKE ? OR phone LIKE ?) ORDER BY name ASC').all(shopId, `%${q}%`, `%${q}%`)
      : await db.prepare<Customer>('SELECT * FROM customers WHERE shop_id = ? ORDER BY name ASC').all(shopId);
    const withLedgers: Customer[] = [];
    for (const c of rows) {
      const ledger = await db.prepare<CustomerLedgerEntry>('SELECT * FROM customer_ledger WHERE shop_id = ? AND customer_id = ? ORDER BY date ASC').all(shopId, c.id);
      withLedgers.push({ ...c, ledger });
    }
    return withLedgers;
  },
  async getById(id: number): Promise<Customer | undefined> {
    const db = await currentDb();
    const shopId = currentShopId();
    const c = await db.prepare<Customer>('SELECT * FROM customers WHERE id = ? AND shop_id = ?').get(id, shopId);
    if (!c) return undefined;
    c.ledger = await db.prepare<CustomerLedgerEntry>('SELECT * FROM customer_ledger WHERE shop_id = ? AND customer_id = ? ORDER BY date ASC').all(shopId, id);
    return c;
  },
  async create(data: { name: string; phone?: string }): Promise<Customer> {
    const db = await currentDb();
    const shopId = currentShopId();
    const info = await db.prepare('INSERT INTO customers (shop_id, name, phone) VALUES (?, ?, ?)').run(shopId, data.name, data.phone || '');
    return (await this.getById(info.lastInsertRowid))!;
  },
  async logPayment(customerId: number, amount: number, notes: string): Promise<Customer> {
    const db = await currentDb();
    const shopId = currentShopId();
    await db.prepare('UPDATE customers SET balance = balance - ? WHERE id = ? AND shop_id = ?').run(amount, customerId, shopId);
    await db
      .prepare('INSERT INTO customer_ledger (shop_id, customer_id, amount, type, notes) VALUES (?, ?, ?, ?, ?)')
      .run(shopId, customerId, amount, 'PAYMENT', notes || '');
    return (await this.getById(customerId))!;
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
  async create(input: BillInput): Promise<Bill> {
    const subtotal = input.items.reduce((s, i) => s + i.total, 0);
    const total = Math.max(0, subtotal - (input.discount || 0));
    const billNumber = generateBillNumber();

    const billId = await runInTransaction(async () => {
      const db = await currentDb();
      const shopId = currentShopId();
      const info = await db
        .prepare(
          `INSERT INTO bills (shop_id, bill_number, customer_id, customer_name, payment_type, subtotal, discount, total, cashier_id, cashier_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          shopId,
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
      const billId = info.lastInsertRowid;

      for (const line of input.items) {
        await db
          .prepare('INSERT INTO bill_items (shop_id, bill_id, item_id, name, quantity, price, total) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(shopId, billId, line.itemId, line.name, line.quantity, line.price, line.total);
        if (line.itemId) await deductStock(line.itemId, line.quantity);
      }

      if (input.paymentType === 'UDHAAR' && input.customerId) {
        await db.prepare('UPDATE customers SET balance = balance + ? WHERE id = ? AND shop_id = ?').run(total, input.customerId, shopId);
        await db
          .prepare('INSERT INTO customer_ledger (shop_id, customer_id, amount, type, bill_id, notes) VALUES (?, ?, ?, ?, ?, ?)')
          .run(shopId, input.customerId, total, 'CREDIT', billId, billNumber);
      }

      return billId;
    });

    return this.getById(billId);
  },
  async getById(id: number): Promise<Bill> {
    const db = await currentDb();
    const shopId = currentShopId();
    const bill = (await db.prepare<Bill>('SELECT * FROM bills WHERE id = ? AND shop_id = ?').get(id, shopId))!;
    const items = await db.prepare<BillItem>('SELECT * FROM bill_items WHERE bill_id = ? AND shop_id = ?').all(id, shopId);
    return { ...bill, items };
  },
  async getByNumber(billNumber: string): Promise<Bill | undefined> {
    const db = await currentDb();
    const shopId = currentShopId();
    const bill = await db.prepare<Bill>('SELECT * FROM bills WHERE bill_number = ? AND shop_id = ?').get(billNumber, shopId);
    if (!bill) return undefined;
    const items = await db.prepare<BillItem>('SELECT * FROM bill_items WHERE bill_id = ? AND shop_id = ?').all(bill.id, shopId);
    return { ...bill, items };
  },
  async list(opts: { limit?: number; from?: string; to?: string; type?: string } = {}): Promise<Bill[]> {
    const db = await currentDb();
    const shopId = currentShopId();
    const clauses: string[] = ['shop_id = ?'];
    const params: (string | number)[] = [shopId];
    if (opts.from) { clauses.push('created_at >= ?'); params.push(opts.from); }
    if (opts.to) { clauses.push('created_at <= ?'); params.push(opts.to); }
    if (opts.type && opts.type !== 'ALL') { clauses.push('payment_type = ?'); params.push(opts.type); }
    const where = `WHERE ${clauses.join(' AND ')}`;
    return db.prepare<Bill>(`SELECT * FROM bills ${where} ORDER BY created_at DESC LIMIT ?`).all(...params, opts.limit || 200);
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
  async create(input: ReturnInput) {
    const bill = await billsRepo.getById(input.billId);
    if (!bill) throw new Error('Bill not found');

    return runInTransaction(async () => {
      const db = await currentDb();
      const shopId = currentShopId();
      let refundAmount = 0;
      const returnNumber = generateReturnNumber();
      const returnInfo = await db
        .prepare('INSERT INTO returns (shop_id, return_number, bill_id, refund_amount, refund_method, notes, cashier_id) VALUES (?, ?, ?, 0, ?, ?, ?)')
        .run(shopId, returnNumber, input.billId, input.refundMethod, input.notes || '', input.cashierId);
      const returnId = returnInfo.lastInsertRowid;

      for (const line of input.lines) {
        const billItem = (bill.items || []).find((i) => i.id === line.billItemId);
        if (!billItem) continue;
        const remaining = billItem.quantity - billItem.returned_quantity;
        const qty = Math.min(line.quantity, remaining);
        if (qty <= 0) continue;
        const lineTotal = qty * billItem.price;
        refundAmount += lineTotal;

        await db.prepare('UPDATE bill_items SET returned_quantity = returned_quantity + ? WHERE id = ? AND shop_id = ?').run(qty, billItem.id, shopId);
        await db
          .prepare('INSERT INTO return_items (shop_id, return_id, bill_item_id, item_id, quantity, price, total) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(shopId, returnId, billItem.id, billItem.item_id, qty, billItem.price, lineTotal);
        if (billItem.item_id) await restockItem(billItem.item_id, qty, 0);
      }

      await db.prepare('UPDATE returns SET refund_amount = ? WHERE id = ? AND shop_id = ?').run(refundAmount, returnId, shopId);

      const updatedItems = await db.prepare<BillItem>('SELECT * FROM bill_items WHERE bill_id = ? AND shop_id = ?').all(input.billId, shopId);
      const fullyReturned = updatedItems.every((i) => i.returned_quantity >= i.quantity);
      const anyReturned = updatedItems.some((i) => i.returned_quantity > 0);
      const status = fullyReturned ? 'RETURNED' : anyReturned ? 'PARTIAL_RETURN' : 'COMPLETED';
      await db.prepare('UPDATE bills SET status = ? WHERE id = ? AND shop_id = ?').run(status, input.billId, shopId);

      if (input.refundMethod === 'UDHAAR_ADJUST' && bill.customer_id) {
        await db.prepare('UPDATE customers SET balance = balance - ? WHERE id = ? AND shop_id = ?').run(refundAmount, bill.customer_id, shopId);
        await db
          .prepare('INSERT INTO customer_ledger (shop_id, customer_id, amount, type, bill_id, notes) VALUES (?, ?, ?, ?, ?, ?)')
          .run(shopId, bill.customer_id, refundAmount, 'PAYMENT', input.billId, `Return ${returnNumber}`);
      }

      return returnId;
    });
  },
};

// ── USERS / AUTH ─────────────────────────────────────────────────────────────
function toPublicUser(u: User): PublicUser {
  const { password_hash, ...rest } = u;
  void password_hash;
  return rest;
}

export const usersRepo = {
  async list(): Promise<PublicUser[]> {
    const db = await currentDb();
    const rows = await db.prepare<User>('SELECT * FROM users WHERE shop_id = ? ORDER BY name ASC').all(currentShopId());
    return rows.map(toPublicUser);
  },
  async getById(id: number): Promise<PublicUser | undefined> {
    const db = await currentDb();
    const u = await db.prepare<User>('SELECT * FROM users WHERE id = ? AND shop_id = ?').get(id, currentShopId());
    return u ? toPublicUser(u) : undefined;
  },
  async authenticate(username: string, password: string): Promise<PublicUser | null> {
    const db = await currentDb();
    const u = await db.prepare<User>('SELECT * FROM users WHERE username = ? AND shop_id = ? AND active = 1').get(username, currentShopId());
    if (!u) return null;
    if (!bcrypt.compareSync(password, u.password_hash)) return null;
    return toPublicUser(u);
  },
  async create(data: { username: string; password: string; name: string; role: 'ADMIN' | 'CASHIER' }): Promise<PublicUser> {
    const db = await currentDb();
    const shopId = currentShopId();
    const hash = bcrypt.hashSync(data.password, 10);
    const info = await db
      .prepare('INSERT INTO users (shop_id, username, password_hash, name, role) VALUES (?, ?, ?, ?, ?)')
      .run(shopId, data.username, hash, data.name, data.role);
    return (await this.getById(info.lastInsertRowid))!;
  },
  async setActive(id: number, active: boolean) {
    const db = await currentDb();
    await db.prepare('UPDATE users SET active = ? WHERE id = ? AND shop_id = ?').run(active ? 1 : 0, id, currentShopId());
  },
  async resetPassword(id: number, password: string) {
    const db = await currentDb();
    const hash = bcrypt.hashSync(password, 10);
    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ? AND shop_id = ?').run(hash, id, currentShopId());
  },
};

// ── SETTINGS ─────────────────────────────────────────────────────────────────
export const settingsRepo = {
  async getAll(): Promise<Record<string, string>> {
    const db = await currentDb();
    const rows = await db.prepare<{ key: string; value: string }>('SELECT key, value FROM settings WHERE shop_id = ?').all(currentShopId());
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  },
  async update(values: Record<string, string>) {
    const db = await currentDb();
    const shopId = currentShopId();
    const upsert = db.prepare(
      'INSERT INTO settings (shop_id, key, value) VALUES (?, ?, ?) ON CONFLICT(shop_id, key) DO UPDATE SET value = excluded.value'
    );
    for (const [k, v] of Object.entries(values)) {
      await upsert.run(shopId, k, String(v));
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
    const shopId = currentShopId();
    const bills = await db
      .prepare<DailyBillRow>(
        `SELECT b.id, b.bill_number, b.created_at, b.customer_name, b.payment_type, b.status, b.total,
                (SELECT COUNT(*) FROM bill_items bi WHERE bi.bill_id = b.id) AS item_count,
                (SELECT COALESCE(SUM(bi.quantity * COALESCE(i.cost_price, 0)), 0)
                   FROM bill_items bi LEFT JOIN items i ON i.id = bi.item_id
                  WHERE bi.bill_id = b.id) AS cost
           FROM bills b
          WHERE b.shop_id = ? AND date(b.created_at) = date(?) AND b.status != 'RETURNED'
          ORDER BY b.created_at ASC`
      )
      .all(shopId, date);

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
    const shopId = currentShopId();
    const start = new Date();
    start.setMonth(start.getMonth() - (months - 1));
    start.setDate(1);
    start.setHours(0, 0, 0, 0);

    const salesRows = await db
      .prepare<{ month: string; count: number; total: number }>(
        `SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS count, COALESCE(SUM(total), 0) AS total
           FROM bills WHERE shop_id = ? AND status != 'RETURNED' AND created_at >= ?
          GROUP BY month`
      )
      .all(shopId, start.toISOString());

    const costRows = await db
      .prepare<{ month: string; cost: number }>(
        `SELECT strftime('%Y-%m', b.created_at) AS month, COALESCE(SUM(bi.quantity * COALESCE(i.cost_price, 0)), 0) AS cost
           FROM bill_items bi JOIN bills b ON b.id = bi.bill_id LEFT JOIN items i ON i.id = bi.item_id
          WHERE b.shop_id = ? AND b.status != 'RETURNED' AND b.created_at >= ?
          GROUP BY month`
      )
      .all(shopId, start.toISOString());

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
  async yearly(years = 5) {
    const db = await currentDb();
    const shopId = currentShopId();
    const startYear = new Date().getFullYear() - (years - 1);
    const start = new Date(startYear, 0, 1);

    const salesRows = await db
      .prepare<{ year: string; count: number; total: number }>(
        `SELECT strftime('%Y', created_at) AS year, COUNT(*) AS count, COALESCE(SUM(total), 0) AS total
           FROM bills WHERE shop_id = ? AND status != 'RETURNED' AND created_at >= ?
          GROUP BY year`
      )
      .all(shopId, start.toISOString());

    const costRows = await db
      .prepare<{ year: string; cost: number }>(
        `SELECT strftime('%Y', b.created_at) AS year, COALESCE(SUM(bi.quantity * COALESCE(i.cost_price, 0)), 0) AS cost
           FROM bill_items bi JOIN bills b ON b.id = bi.bill_id LEFT JOIN items i ON i.id = bi.item_id
          WHERE b.shop_id = ? AND b.status != 'RETURNED' AND b.created_at >= ?
          GROUP BY year`
      )
      .all(shopId, start.toISOString());

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
    const shopId = currentShopId();
    const byCategory = await db
      .prepare<{ category: string; itemCount: number; totalQty: number; costValue: number; saleValue: number }>(
        `SELECT category,
                COUNT(*) AS itemCount,
                COALESCE(SUM(quantity), 0) AS totalQty,
                COALESCE(SUM(quantity * cost_price), 0) AS costValue,
                COALESCE(SUM(quantity * sale_price), 0) AS saleValue
           FROM items
          WHERE shop_id = ?
          GROUP BY category
          ORDER BY category ASC`
      )
      .all(shopId);

    const totals = (await db
      .prepare<{ totalItems: number; totalQty: number; totalCostValue: number; totalSaleValue: number }>(
        `SELECT COUNT(*) AS totalItems,
                COALESCE(SUM(quantity), 0) AS totalQty,
                COALESCE(SUM(quantity * cost_price), 0) AS totalCostValue,
                COALESCE(SUM(quantity * sale_price), 0) AS totalSaleValue
           FROM items
          WHERE shop_id = ?`
      )
      .get(shopId))!;

    const lowStock = (await db.prepare<{ c: number }>('SELECT COUNT(*) AS c FROM items WHERE shop_id = ? AND quantity > 0 AND quantity <= low_stock_threshold').get(shopId))!;
    const outOfStock = (await db.prepare<{ c: number }>('SELECT COUNT(*) AS c FROM items WHERE shop_id = ? AND quantity <= 0').get(shopId))!;

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
