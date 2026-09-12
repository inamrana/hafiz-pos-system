import { NextRequest, NextResponse } from 'next/server';
import { currentDb } from '@/lib/tenant-context';
import { itemsRepo, settingsRepo } from '@/lib/repo';
import { withAuth } from '@/lib/api-auth';
import { shopNowParts, shopMidnightUtc, SHOP_TZ_SHIFT_SQL } from '@/lib/utils';

export async function GET(req: NextRequest) {
  return withAuth(req, async () => {
    const db = await currentDb();

    const today = shopNowParts();
    const todayStart = shopMidnightUtc(today);
    const monthStart = shopMidnightUtc({ ...today, day: 1 });
    const yearStart = shopMidnightUtc({ year: today.year, month: 1, day: 1 });
    const sevenDaysAgo = new Date(todayStart.getTime() - 6 * 86400000);

    // All of these are independent — fire them together instead of awaiting one
    // at a time, since each round trip to a remote Turso database adds up fast.
    const [
      settings,
      todaySales,
      monthlySales,
      yearlySales,
      totalUdhaar,
      totalPayables,
      totalItems,
      lowStockItems,
      dailyChart,
      topItems,
    ] = await Promise.all([
      settingsRepo.getAll(),
      db
        .prepare<{ total: number; count: number }>(
          "SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS count FROM bills WHERE created_at >= ? AND status != 'RETURNED'"
        )
        .get(todayStart.toISOString()) as Promise<{ total: number; count: number }>,
      db
        .prepare<{ total: number; count: number }>(
          "SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS count FROM bills WHERE created_at >= ? AND status != 'RETURNED'"
        )
        .get(monthStart.toISOString()) as Promise<{ total: number; count: number }>,
      db
        .prepare<{ total: number }>("SELECT COALESCE(SUM(total),0) AS total FROM bills WHERE created_at >= ? AND status != 'RETURNED'")
        .get(yearStart.toISOString()) as Promise<{ total: number }>,
      db.prepare<{ total: number }>('SELECT COALESCE(SUM(balance),0) AS total FROM customers').get() as Promise<{ total: number }>,
      db.prepare<{ total: number }>('SELECT COALESCE(SUM(balance),0) AS total FROM suppliers').get() as Promise<{ total: number }>,
      db.prepare<{ c: number }>('SELECT COUNT(*) AS c FROM items').get() as Promise<{ c: number }>,
      itemsRepo.lowStock(),
      db
        .prepare(
          `SELECT date(datetime(created_at, ${SHOP_TZ_SHIFT_SQL})) AS _id, COALESCE(SUM(total),0) AS total, COUNT(*) AS count
           FROM bills WHERE created_at >= ? AND status != 'RETURNED'
           GROUP BY date(datetime(created_at, ${SHOP_TZ_SHIFT_SQL})) ORDER BY _id ASC`
        )
        .all(sevenDaysAgo.toISOString()),
      db
        .prepare(
          `SELECT bi.name, SUM(bi.quantity) AS totalQty, SUM(bi.total) AS totalRevenue
           FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
           WHERE b.created_at >= ? AND b.status != 'RETURNED'
           GROUP BY bi.name ORDER BY totalRevenue DESC LIMIT 5`
        )
        .all(monthStart.toISOString()),
    ]);

    const nearExpiryDays = Number(settings.nearExpiryDays || 30);
    const expiringBatches = await itemsRepo.expiringBatches(nearExpiryDays);

    return NextResponse.json({
      todaySales: todaySales.total,
      todayBills: todaySales.count,
      monthlySales: monthlySales.total,
      monthlyBills: monthlySales.count,
      yearlySales: yearlySales.total,
      totalUdhaar: totalUdhaar.total,
      totalPayables: totalPayables.total,
      totalItems: totalItems.c,
      lowStockItems,
      expiringBatches,
      dailyChart,
      topItems,
    });
  });
}
