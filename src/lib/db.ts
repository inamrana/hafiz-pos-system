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
  returned_quantity REAL NOT NULL DEFAULT 0,
  cost_price REAL
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

/** Only manual changes live here (corrections, edits, deletes, merges, imports,
 *  deleted expenses). Sales, purchases and returns are NOT copied in — they're read
 *  straight from their own tables, so nothing is stored twice. */
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  item_id INTEGER,
  item_name TEXT,
  qty_change REAL,
  qty_before REAL,
  qty_after REAL,
  amount REAL,
  reference TEXT DEFAULT '',
  reason TEXT DEFAULT '',
  details TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_item ON activity_log(item_id);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL DEFAULT 'Other',
  description TEXT DEFAULT '',
  amount REAL NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'CASH',
  expense_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);

-- Lookups by product (item history, merge, delete checks) and by return.
CREATE INDEX IF NOT EXISTS idx_bill_items_item ON bill_items(item_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_item ON purchase_items(item_id);
CREATE INDEX IF NOT EXISTS idx_return_items_item ON return_items(item_id);
CREATE INDEX IF NOT EXISTS idx_return_items_return ON return_items(return_id);
CREATE INDEX IF NOT EXISTS idx_returns_created ON returns(created_at);
CREATE INDEX IF NOT EXISTS idx_returns_bill ON returns(bill_id);
`;

/**
 * Bump when the schema changes. The version is stored in the settings table, so a
 * cold start costs ONE small query once the database is up to date — instead of
 * re-running every CREATE/ALTER statement on every serverless cold start.
 */
const SCHEMA_VERSION = 2;

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

/** Same rule as normalizeItemName in repo.ts — the duplicate-detection key stored in items.name_key. */
function nameKey(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Adds a column introduced after the table's original CREATE TABLE. Tolerates a
 * concurrent cold start having just added it (two serverless instances migrating
 * at once).
 */
async function addColumnIfMissing(client: Client, table: string, column: string, ddl: string) {
  const info = await client.execute(`PRAGMA table_info(${table})`);
  if (info.rows.some((r) => (r as unknown as { name: string }).name === column)) return;
  try {
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  } catch (e) {
    if (!(e instanceof Error && /duplicate column/i.test(e.message))) throw e;
  }
}

async function currentSchemaVersion(client: Client): Promise<number> {
  try {
    const r = await client.execute("SELECT value FROM settings WHERE key = 'schema_version'");
    return Number((r.rows[0] as unknown as { value?: string } | undefined)?.value || 0);
  } catch {
    return 0; // brand-new database: no settings table yet
  }
}

async function migrate(client: Client) {
  // Every statement is idempotent (IF NOT EXISTS), so re-running after an
  // interrupted migration is safe. Sent as one request.
  await client.executeMultiple(SCHEMA_SQL);

  await addColumnIfMissing(client, 'bill_items', 'cost_price', 'cost_price REAL');
  await addColumnIfMissing(client, 'items', 'archived', 'archived INTEGER NOT NULL DEFAULT 0');
  await addColumnIfMissing(client, 'items', 'name_key', "name_key TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing(client, 'bills', 'client_ref', 'client_ref TEXT');
  await addColumnIfMissing(client, 'purchases', 'notes', "notes TEXT DEFAULT ''");

  // Fill name_key for existing items so duplicate checks are an index lookup
  // instead of reading the whole items table.
  const missing = await client.execute("SELECT id, name FROM items WHERE name_key = ''");
  const updates = missing.rows.map((r) => {
    const row = r as unknown as { id: number; name: string };
    return { sql: 'UPDATE items SET name_key = ? WHERE id = ?', args: [nameKey(row.name), row.id] };
  });

  await client.batch(
    [
      ...updates,
      'CREATE INDEX IF NOT EXISTS idx_items_name_key ON items(name_key)',
      // A checkout retried by a double key press / flaky network is recognised as
      // the same sale instead of deducting stock twice. NULLs don't collide.
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_bills_client_ref ON bills(client_ref)',
      // Item history shows exact running stock only from this moment on.
      "INSERT OR IGNORE INTO settings (key, value) VALUES ('history_started', datetime('now'))",
      {
        sql: "INSERT INTO settings (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        args: [String(SCHEMA_VERSION)],
      },
    ],
    'write'
  );
}

/** Brings the schema up to date once per process, lazily on first real use. */
export function ready(): Promise<void> {
  if (!global.__libsqlReady) {
    global.__libsqlReady = (async () => {
      const client = getRawClient();
      if ((await currentSchemaVersion(client)) < SCHEMA_VERSION) await migrate(client);
    })().catch((e) => {
      // Don't cache a failed migration forever — let the next request retry.
      global.__libsqlReady = undefined;
      throw e;
    });
  }
  return global.__libsqlReady;
}

export async function getClient(): Promise<Client> {
  await ready();
  return getRawClient();
}
