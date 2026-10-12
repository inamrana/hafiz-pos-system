import type { InArgs, Row } from '@libsql/client';
import { getClient } from './db';

interface Stmt<T> {
  all(...args: unknown[]): Promise<T[]>;
  get(...args: unknown[]): Promise<T | undefined>;
  run(...args: unknown[]): Promise<{ lastInsertRowid: number; changes: number }>;
}

export interface Db {
  prepare<T = Record<string, unknown>>(sql: string): Stmt<T>;
}

/** One SQL statement for a batch: `sql('UPDATE items SET x = ? WHERE id = ?', x, id)`. */
export interface Statement {
  sql: string;
  args: InArgs;
}

export function sql(text: string, ...args: unknown[]): Statement {
  return { sql: text, args: args as InArgs };
}

function rowToObject(row: Row): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const key of Object.keys(row)) obj[key] = (row as unknown as Record<string, unknown>)[key];
  return obj;
}

/** Handle for single read queries (and the odd standalone write). */
export async function currentDb(): Promise<Db> {
  const client = await getClient();
  return {
    prepare: <T,>(text: string): Stmt<T> => ({
      async all(...args: unknown[]) {
        const r = await client.execute({ sql: text, args: args as InArgs });
        return r.rows.map(rowToObject) as T[];
      },
      async get(...args: unknown[]) {
        const r = await client.execute({ sql: text, args: args as InArgs });
        return r.rows[0] ? (rowToObject(r.rows[0]) as T) : undefined;
      },
      async run(...args: unknown[]) {
        const r = await client.execute({ sql: text, args: args as InArgs });
        return { lastInsertRowid: Number(r.lastInsertRowid ?? 0), changes: r.rowsAffected };
      },
    }),
  };
}

/**
 * Sends every statement in ONE request and applies them atomically — all or
 * nothing. This replaces interactive transactions, which held Turso's write lock
 * open across one network round trip per statement: a slow sale (or a serverless
 * function cut off half-way) kept the database locked and every other write
 * waited behind it. A batch can't be left half-open.
 *
 * Statements that need an id created earlier in the same batch look it up by a
 * unique column (e.g. `(SELECT id FROM bills WHERE bill_number = ?)`).
 */
export async function writeBatch(statements: Statement[]) {
  if (statements.length === 0) return [];
  const client = await getClient();
  return client.batch(statements, 'write');
}

/** Runs several read queries in one request; returns each query's rows. */
export async function readBatch(statements: Statement[]): Promise<Record<string, unknown>[][]> {
  if (statements.length === 0) return [];
  const client = await getClient();
  const results = await client.batch(statements, 'read');
  return results.map((r) => r.rows.map(rowToObject));
}
