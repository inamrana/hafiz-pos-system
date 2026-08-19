import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const dataDir = process.env.DATA_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

declare global {
  // eslint-disable-next-line no-var
  var __platformDb: Database.Database | undefined;
}

const platformDb = global.__platformDb || new Database(path.join(dataDir, 'platform.db'));
if (!global.__platformDb) global.__platformDb = platformDb;

platformDb.pragma('journal_mode = WAL');
platformDb.pragma('busy_timeout = 5000');

platformDb.exec(`
CREATE TABLE IF NOT EXISTS shops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  db_filename TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_shops_owner_email ON shops(owner_email);

CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

export function getPlatformSecret(): string {
  const row = platformDb.prepare('SELECT value FROM platform_settings WHERE key = ?').get('authSecret') as
    | { value: string }
    | undefined;
  if (row?.value) return row.value;
  const secret = crypto.randomBytes(32).toString('hex');
  platformDb
    .prepare('INSERT INTO platform_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run('authSecret', secret);
  return secret;
}

export interface Shop {
  id: number;
  shop_code: string;
  name: string;
  owner_name: string;
  owner_email: string;
  db_filename: string;
  created_at: string;
}

function generateShopCode(): string {
  // Unambiguous alphabet (no 0/O/1/I) so codes are easy for cashiers to read/type.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code: string;
  do {
    code = Array.from({ length: 6 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  } while (getShopByCode(code));
  return code;
}

export const shopsRepo = {
  create(data: { name: string; ownerName: string; ownerEmail: string }): Shop {
    const shopCode = generateShopCode();
    const dbFilename = `shop-${shopCode.toLowerCase()}.db`;
    const info = platformDb
      .prepare('INSERT INTO shops (shop_code, name, owner_name, owner_email, db_filename) VALUES (?, ?, ?, ?, ?)')
      .run(shopCode, data.name, data.ownerName, data.ownerEmail, dbFilename);
    return this.getById(info.lastInsertRowid as number)!;
  },
  getById(id: number): Shop | undefined {
    return platformDb.prepare('SELECT * FROM shops WHERE id = ?').get(id) as Shop | undefined;
  },
  getByCode(code: string): Shop | undefined {
    return getShopByCode(code);
  },
};

function getShopByCode(code: string): Shop | undefined {
  return platformDb.prepare('SELECT * FROM shops WHERE shop_code = ?').get(code.toUpperCase()) as Shop | undefined;
}

export { dataDir };
export default platformDb;
