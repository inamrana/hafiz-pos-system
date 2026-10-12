import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number) {
  return `Rs. ${amount.toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/**
 * SQLite's `datetime('now')` stores UTC as "YYYY-MM-DD HH:MM:SS" with no timezone
 * marker. `new Date(...)` treats that exact shape as LOCAL time rather than UTC
 * when parsed directly, so every timestamp read back from the database — bill and
 * purchase times, ledger dates — displays off by the local UTC offset. This makes
 * the UTC-ness explicit before parsing, so it converts to the viewer's local time
 * correctly. Already-ISO strings (with 'T'/'Z') and plain dates pass through as-is.
 */
export function parseServerDate(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return new Date(value.replace(' ', 'T') + 'Z');
  }
  return new Date(value);
}

const SHOP_TIMEZONE = 'Asia/Karachi';
// Pakistan doesn't observe DST, so a fixed offset is safe (unlike most other zones).
const SHOP_UTC_OFFSET_HOURS = 5;

/** The shop's SQL `datetime()` modifier that shifts a UTC timestamp column to Karachi wall-clock time before bucketing by date(), strftime(), etc. */
export const SHOP_TZ_SHIFT_SQL = `'+${SHOP_UTC_OFFSET_HOURS} hours'`;

/** The shop's current wall-clock date, regardless of where this code actually runs (Vercel serverless runs in UTC no matter where the shop is). */
export function shopNowParts(): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHOP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get('year'), month: get('month'), day: get('day') };
}

/**
 * The UTC instant corresponding to local midnight in the shop's timezone, for the
 * given year/month/day (defaults to today). `Date.UTC` normalizes an out-of-range
 * month/day itself (e.g. month 0 rolls back a year), so callers can step by whole
 * months/years without extra carry logic.
 */
export function shopMidnightUtc(parts: { year: number; month: number; day: number } = shopNowParts()): Date {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day) - SHOP_UTC_OFFSET_HOURS * 3600 * 1000);
}

/**
 * A UTC instant in SQLite's own timestamp format ("YYYY-MM-DD HH:MM:SS") — the
 * format datetime('now') stores in created_at. Comparing created_at against an ISO
 * string ("...T...Z") goes wrong on the same date, because ' ' sorts before 'T'.
 */
export function toSqlTimestamp(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/** Normalises a client-sent ISO timestamp to toSqlTimestamp form (unparseable input passes through). */
export function sqlTimestampOf(value: string): string {
  const d = parseServerDate(value);
  return Number.isNaN(d.getTime()) ? value : toSqlTimestamp(d);
}

/**
 * [start, end) UTC bounds covering the shop-local calendar days `from`..`to`
 * (YYYY-MM-DD, inclusive). Filtering `created_at >= start AND created_at < end`
 * uses the created_at index; wrapping the column in date(...) would scan every row.
 */
export function shopDayRangeSql(from: string, to: string): [string, string] {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return [
    toSqlTimestamp(shopMidnightUtc({ year: fy, month: fm, day: fd })),
    toSqlTimestamp(shopMidnightUtc({ year: ty, month: tm, day: td + 1 })),
  ];
}

/**
 * "Today" in the shop's own timezone, regardless of where this code actually runs —
 * Vercel's serverless functions run in UTC no matter where the shop is, so plain
 * `new Date()` local getters give the wrong calendar day there. Used for anything
 * server-side that needs "today" for the shop (invoice/purchase/return numbers,
 * the daily report's default date).
 */
export function shopToday(): string {
  const { year, month, day } = shopNowParts();
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * "Today" as YYYY-MM-DD from wherever this actually runs — for client-side date
 * pickers, where the browser's own local timezone already is the shop's. Unlike
 * `toISOString().slice(0, 10)`, this doesn't silently shift to UTC.
 */
export function localDateInput(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function randomCode(prefix: string) {
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `${prefix}-${shopToday().replace(/-/g, '')}-${rand}`;
}

export function generateBillNumber() {
  return randomCode('INV');
}

export function generatePurchaseNumber() {
  return randomCode('PO');
}

export function generateReturnNumber() {
  return randomCode('RTN');
}
