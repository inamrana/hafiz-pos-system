import { AsyncLocalStorage } from 'async_hooks';
import type Database from 'better-sqlite3';
import { getShopDb } from './db';
import { shopsRepo } from './platform-db';

interface TenantStore {
  db: Database.Database;
  shopId: number;
}

const storage = new AsyncLocalStorage<TenantStore>();

/**
 * Runs `fn` with the given shop's database bound as the "current" tenant database.
 * Every repo.ts function reads the db via currentDb() instead of a global import,
 * so concurrent requests for different shops never cross-contaminate — each request's
 * AsyncLocalStorage store is isolated even across awaits.
 */
export async function withTenant<T>(shopId: number, fn: () => T | Promise<T>): Promise<T> {
  const shop = shopsRepo.getById(shopId);
  if (!shop) throw new Error('Unknown shop');
  const db = getShopDb(shop.id, shop.db_filename);
  return storage.run({ db, shopId }, fn);
}

export function currentDb(): Database.Database {
  const store = storage.getStore();
  if (!store) {
    throw new Error('No tenant context is active — this repo call must happen inside withTenant().');
  }
  return store.db;
}

export function currentShopId(): number | null {
  return storage.getStore()?.shopId ?? null;
}
