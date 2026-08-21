import { AsyncLocalStorage } from 'async_hooks';
import type { Transaction, InArgs, Row } from '@libsql/client';
import { getClient } from './db';

interface Store {
  shopId: number;
  tx?: Transaction;
}

const storage = new AsyncLocalStorage<Store>();

/**
 * Runs `fn` scoped to a shop. Every repo.ts call inside (directly or via nested
 * async calls) reads the shop id via currentShopId() and the db via currentDb() —
 * AsyncLocalStorage keeps this isolated per-request even under concurrent access
 * from different shops.
 */
export async function withTenant<T>(shopId: number, fn: () => T | Promise<T>): Promise<T> {
  return storage.run({ shopId }, fn);
}

export function currentShopId(): number {
  const store = storage.getStore();
  if (!store) throw new Error('No tenant context is active — this call must happen inside withTenant().');
  return store.shopId;
}

interface Executor {
  execute(stmt: { sql: string; args: InArgs }): Promise<{ rows: Row[]; rowsAffected: number; lastInsertRowid?: bigint }>;
}

interface Stmt<T> {
  all(...args: unknown[]): Promise<T[]>;
  get(...args: unknown[]): Promise<T | undefined>;
  run(...args: unknown[]): Promise<{ lastInsertRowid: number; changes: number }>;
}

export interface Db {
  prepare<T = Record<string, unknown>>(sql: string): Stmt<T>;
}

function rowToObject(row: Row): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const key of Object.keys(row)) obj[key] = (row as unknown as Record<string, unknown>)[key];
  return obj;
}

function makeStmt<T>(executor: Executor, sql: string): Stmt<T> {
  return {
    async all(...args: unknown[]) {
      const r = await executor.execute({ sql, args: args as InArgs });
      return r.rows.map(rowToObject) as T[];
    },
    async get(...args: unknown[]) {
      const r = await executor.execute({ sql, args: args as InArgs });
      return r.rows[0] ? (rowToObject(r.rows[0]) as T) : undefined;
    },
    async run(...args: unknown[]) {
      const r = await executor.execute({ sql, args: args as InArgs });
      return { lastInsertRowid: Number(r.lastInsertRowid ?? 0), changes: r.rowsAffected };
    },
  };
}

/** The active db handle for the current tenant context — uses the ambient transaction when one is open. */
export async function currentDb(): Promise<Db> {
  const store = storage.getStore();
  const executor: Executor = store?.tx ?? (await getClient());
  return { prepare: <T,>(sql: string) => makeStmt<T>(executor, sql) };
}

/**
 * Runs `fn` inside an interactive transaction bound to the current tenant context.
 * Every currentDb() call made inside fn — directly or via further nested async
 * calls — transparently joins the same transaction, so multi-statement writes
 * (e.g. a bill plus its line items and stock deductions) are atomic.
 */
export async function runInTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const store = storage.getStore();
  if (!store) throw new Error('No tenant context is active — runInTransaction() must happen inside withTenant().');
  const client = await getClient();
  const tx = await client.transaction('write');
  try {
    const result = await storage.run({ ...store, tx }, fn);
    await tx.commit();
    return result;
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}
