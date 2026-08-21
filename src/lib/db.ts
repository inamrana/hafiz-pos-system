import { createClient, type Client } from '@libsql/client';
import path from 'path';
import fs from 'fs';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS shops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_shops_owner_email ON shops(owner_email);

CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('ADMIN','CASHIER')) DEFAULT 'CASHIER',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(shop_id, username)
);

CREATE TABLE IF NOT EXISTS settings (
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (shop_id, key)
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  barcode TEXT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  cost_price REAL NOT NULL DEFAULT 0,
  sale_price REAL NOT NULL DEFAULT 0,
  quantity REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'Pcs',
  unit_type TEXT NOT NULL DEFAULT 'COUNT' CHECK(unit_type IN ('COUNT','WEIGHT')),
  low_stock_threshold REAL NOT NULL DEFAULT 5,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(shop_id, barcode)
);
CREATE INDEX IF NOT EXISTS idx_items_shop_name ON items(shop_id, name);
CREATE INDEX IF NOT EXISTS idx_items_shop_category ON items(shop_id, category);

CREATE TABLE IF NOT EXISTS stock_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  quantity REAL NOT NULL,
  cost_price REAL NOT NULL DEFAULT 0,
  expiry_date TEXT,
  purchase_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_batches_shop_item ON stock_batches(shop_id, item_id);
CREATE INDEX IF NOT EXISTS idx_batches_shop_expiry ON stock_batches(shop_id, expiry_date);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  balance REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_suppliers_shop ON suppliers(shop_id);

CREATE TABLE IF NOT EXISTS supplier_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  amount REAL NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('PURCHASE','PAYMENT')),
  notes TEXT DEFAULT '',
  purchase_id INTEGER,
  date TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_supplier_ledger_shop ON supplier_ledger(shop_id, supplier_id);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  purchase_number TEXT NOT NULL,
  supplier_id INTEGER REFERENCES suppliers(id),
  supplier_name TEXT DEFAULT 'Unknown Supplier',
  payment_type TEXT NOT NULL CHECK(payment_type IN ('CASH','CREDIT')) DEFAULT 'CASH',
  subtotal REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(shop_id, purchase_number)
);
CREATE INDEX IF NOT EXISTS idx_purchases_shop_created ON purchases(shop_id, created_at);

CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  item_id INTEGER REFERENCES items(id),
  name TEXT NOT NULL,
  quantity REAL NOT NULL,
  cost_price REAL NOT NULL,
  expiry_date TEXT,
  total REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchase_items_shop_purchase ON purchase_items(shop_id, purchase_id);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  balance REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_customers_shop_name ON customers(shop_id, name);

CREATE TABLE IF NOT EXISTS customer_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  amount REAL NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('CREDIT','PAYMENT')),
  bill_id INTEGER,
  notes TEXT DEFAULT '',
  date TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_customer_ledger_shop_customer ON customer_ledger(shop_id, customer_id);

CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  bill_number TEXT NOT NULL,
  customer_id INTEGER REFERENCES customers(id),
  customer_name TEXT DEFAULT 'Walk-in Customer',
  payment_type TEXT NOT NULL CHECK(payment_type IN ('CASH','CARD','UDHAAR')) DEFAULT 'CASH',
  subtotal REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK(status IN ('COMPLETED','RETURNED','PARTIAL_RETURN')),
  cashier_id INTEGER REFERENCES users(id),
  cashier_name TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(shop_id, bill_number)
);
CREATE INDEX IF NOT EXISTS idx_bills_shop_created ON bills(shop_id, created_at);

CREATE TABLE IF NOT EXISTS bill_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  item_id INTEGER REFERENCES items(id),
  name TEXT NOT NULL,
  quantity REAL NOT NULL,
  price REAL NOT NULL,
  total REAL NOT NULL,
  returned_quantity REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_bill_items_shop_bill ON bill_items(shop_id, bill_id);

CREATE TABLE IF NOT EXISTS returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  return_number TEXT NOT NULL,
  bill_id INTEGER NOT NULL REFERENCES bills(id),
  refund_amount REAL NOT NULL DEFAULT 0,
  refund_method TEXT NOT NULL CHECK(refund_method IN ('CASH','UDHAAR_ADJUST')) DEFAULT 'CASH',
  notes TEXT DEFAULT '',
  cashier_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(shop_id, return_number)
);

CREATE TABLE IF NOT EXISTS return_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL REFERENCES shops(id),
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
  return createClient({ url: `file:${path.join(dataDir, 'mart-pos.db')}` });
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
