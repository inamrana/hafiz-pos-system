import { NextRequest, NextResponse } from 'next/server';
import { currentDb } from '@/lib/tenant-context';
import { itemsRepo, settingsRepo } from '@/lib/repo';
import { withAuth } from '@/lib/api-auth';
import { shopNowParts, shopMidnightUtc, SHOP_TZ_SHIFT_SQL } from '@/lib/utils';

export async function GET(req: NextRequest) {
  return withAuth(req, async () => {
    const db = await currentDb();
    const settings = await settingsRepo.getAll();
    const nearExpiryDays = Number(settings.nearExpiryDays || 30);

    const today = shopNowParts();
    const todayStart = shopMidnightUtc(today);
    const monthStart = shopMidnightUtc({ ...today, day: 1 });
    const yearStart = shopMidnightUtc({ year: today.year, month: 1, day: 1 });

    const todaySales = (await db
      .prepare<{ total: number; count: number }>(
        "SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS count FROM bills WHERE created_at >= ? AND status != 'RETURNED'"
      )
      .get(todayStart.toISOString()))!;

    const monthlySales = (await db
      .prepare<{ total: number; count: number }>(
        "SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS count FROM bills WHERE created_at >= ? AND status != 'RETURNED'"
      )
      .get(monthStart.toISOString()))!;

    const yearlySales = (await db
      .prepare<{ total: number }>("SELECT COALESCE(SUM(total),0) AS total FROM bills WHERE created_at >= ? AND status != 'RETURNED'")
      .get(yearStart.toISOString()))!;

    const totalUdhaar = (await db.prepare<{ total: number }>('SELECT COALESCE(SUM(balance),0) AS total FROM customers').get())!;
    const totalPayables = (await db.prepare<{ total: number }>('SELECT COALESCE(SUM(balance),0) AS total FROM suppliers').get())!;
    const totalItems = (await db.prepare<{ c: number }>('SELECT COUNT(*) AS c FROM items').get())!;

    const lowStockItems = await itemsRepo.lowStock();
    const expiringBatches = await itemsRepo.expiringBatches(nearExpiryDays);

    const sevenDaysAgo = new Date(todayStart.getTime() - 6 * 86400000);

    const dailyChart = await db
      .prepare(
        `SELECT date(datetime(created_at, ${SHOP_TZ_SHIFT_SQL})) AS _id, COALESCE(SUM(total),0) AS total, COUNT(*) AS count
         FROM bills WHERE created_at >= ? AND status != 'RETURNED'
         GROUP BY date(datetime(created_at, ${SHOP_TZ_SHIFT_SQL})) ORDER BY _id ASC`
      )
      .all(sevenDaysAgo.toISOString());

    const topItems = await db
      .prepare(
        `SELECT bi.name, SUM(bi.quantity) AS totalQty, SUM(bi.total) AS totalRevenue
         FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
         WHERE b.created_at >= ? AND b.status != 'RETURNED'
         GROUP BY bi.name ORDER BY totalRevenue DESC LIMIT 5`
      )
      .all(monthStart.toISOString());

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
