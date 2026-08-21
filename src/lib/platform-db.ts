import crypto from 'crypto';
import { getClient } from './db';

export async function getPlatformSecret(): Promise<string> {
  const client = await getClient();
  const existing = await client.execute({ sql: 'SELECT value FROM platform_settings WHERE key = ?', args: ['authSecret'] });
  const row = existing.rows[0] as unknown as { value: string } | undefined;
  if (row?.value) return row.value;

  const secret = crypto.randomBytes(32).toString('hex');
  await client.execute({
    sql: 'INSERT INTO platform_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    args: ['authSecret', secret],
  });
  return secret;
}

export interface Shop {
  id: number;
  shop_code: string;
  name: string;
  owner_name: string;
  owner_email: string;
  created_at: string;
}

function generateCode(): string {
  // Unambiguous alphabet (no 0/O/1/I) so codes are easy for cashiers to read/type.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
}

async function generateUniqueShopCode(): Promise<string> {
  let code = generateCode();
  while (await shopsRepo.getByCode(code)) {
    code = generateCode();
  }
  return code;
}

export const shopsRepo = {
  async create(data: { name: string; ownerName: string; ownerEmail: string }): Promise<Shop> {
    const client = await getClient();
    const shopCode = await generateUniqueShopCode();
    const info = await client.execute({
      sql: 'INSERT INTO shops (shop_code, name, owner_name, owner_email) VALUES (?, ?, ?, ?)',
      args: [shopCode, data.name, data.ownerName, data.ownerEmail],
    });
    return (await this.getById(Number(info.lastInsertRowid)))!;
  },
  async getById(id: number): Promise<Shop | undefined> {
    const client = await getClient();
    const r = await client.execute({ sql: 'SELECT * FROM shops WHERE id = ?', args: [id] });
    return r.rows[0] as unknown as Shop | undefined;
  },
  async getByCode(code: string): Promise<Shop | undefined> {
    const client = await getClient();
    const r = await client.execute({ sql: 'SELECT * FROM shops WHERE shop_code = ?', args: [code.toUpperCase()] });
    return r.rows[0] as unknown as Shop | undefined;
  },
};
