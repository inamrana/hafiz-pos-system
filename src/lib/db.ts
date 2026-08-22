import { createClient, type Client } from '@libsql/client';
import path from 'path';
import fs from 'fs';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  barcode TEXT UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  cost_price REAL NOT NULL DEFAULT 0,
  sale_price REAL NOT NULL DEFAULT 0,
  quantity REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'Pcs',
  unit_type TEXT NOT NULL DEFAULT 'COUNT' CHECK(unit_type IN ('COUNT','WEIGHT')),
  low_stock_threshold REAL NOT NULL DEFAULT 5,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_items_name ON items(name);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);

CREATE TABLE IF NOT EXISTS stock_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  quantity REAL NOT NULL,
  cost_price REAL NOT NULL DEFAULT 0,
  expiry_date TEXT,
  purchase_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_batches_item ON stock_batches(item_id);
CREATE INDEX IF NOT EXISTS idx_batches_expiry ON stock_batches(expiry_date);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  balance REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS supplier_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  amount REAL NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('PURCHASE','PAYMENT')),
  notes TEXT DEFAULT '',
  purchase_id INTEGER,
  date TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_supplier_ledger_supplier ON supplier_ledger(supplier_id);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_number TEXT NOT NULL UNIQUE,
  supplier_id INTEGER REFERENCES suppliers(id),
  supplier_name TEXT DEFAULT 'Unknown Supplier',
  payment_type TEXT NOT NULL CHECK(payment_type IN ('CASH','CREDIT')) DEFAULT 'CASH',
  subtotal REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_purchases_created ON purchases(created_at);

CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  item_id INTEGER REFERENCES items(id),
  name TEXT NOT NULL,
  quantity REAL NOT NULL,
  cost_price REAL NOT NULL,
  expiry_date TEXT,
  total REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items(purchase_id);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  balance REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);

CREATE TABLE IF NOT EXISTS customer_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  amount REAL NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('CREDIT','PAYMENT')),
  bill_id INTEGER,
  notes TEXT DEFAULT '',
  date TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_customer_ledger_customer ON customer_ledger(customer_id);

CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_number TEXT NOT NULL UNIQUE,
  customer_id INTEGER REFERENCES customers(id),
  customer_name TEXT DEFAULT 'Walk-in Customer',
  payment_type TEXT NOT NULL CHECK(payment_type IN ('CASH','CARD','UDHAAR')) DEFAULT 'CASH',
  subtotal REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK(status IN ('COMPLETED','RETURNED','PARTIAL_RETURN')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bills_created ON bills(created_at);

CREATE TABLE IF NOT EXISTS bill_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  item_id INTEGER REFERENCES items(id),
  name TEXT NOT NULL,
  quantity REAL NOT NULL,
  price REAL NOT NULL,
  total REAL NOT NULL,
  returned_quantity REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_bill_items_bill ON bill_items(bill_id);

CREATE TABLE IF NOT EXISTS returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_number TEXT NOT NULL UNIQUE,
  bill_id INTEGER NOT NULL REFERENCES bills(id),
  refund_amount REAL NOT NULL DEFAULT 0,
  refund_method TEXT NOT NULL CHECK(refund_method IN ('CASH','UDHAAR_ADJUST')) DEFAULT 'CASH',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS return_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id INTEGER NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  bill_item_id INTEGER NOT NULL REFERENCES bill_items(id),
  item_id INTEGER REFERENCES items(id),
  quantity REAL NOT NULL,
  price REAL NOT NULL,
  total REAL NOT NULL
);
`;

declare global {
  // eslint-disable-next-line no-var
  var __libsqlClient: Client | undefined;
  // eslint-disable-next-line no-var
  var __libsqlReady: Promise<void> | undefined;
}

function buildClient(): Client {
  const url = process.env.TURSO_DATABASE_URL;
  if (url) {
    return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  // Local/offline fallback: a plain file, no network or Turso account needed.
  const dataDir = process.env.DATA_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  return createClient({ url: `file:${path.join(dataDir, 'pos.db')}` });
}

function getRawClient(): Client {
  if (!global.__libsqlClient) global.__libsqlClient = buildClient();
  return global.__libsqlClient;
}

/** Runs schema migrations exactly once per process, lazily on first real use. */
export function ready(): Promise<void> {
  if (!global.__libsqlReady) {
    global.__libsqlReady = (async () => {
      const client = getRawClient();
      const statements = SCHEMA_SQL.split(';').map((s) => s.trim()).filter(Boolean);
      for (const sql of statements) {
        await client.execute(sql);
      }
    })();
  }
  return global.__libsqlReady;
}

export async function getClient(): Promise<Client> {
  await ready();
  return getRawClient();
}
