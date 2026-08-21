import { NextRequest, NextResponse } from 'next/server';
import { currentDb, currentShopId } from '@/lib/tenant-context';
import { itemsRepo, settingsRepo } from '@/lib/repo';
import { withAuth } from '@/lib/api-auth';

export async function GET(req: NextRequest) {
  return withAuth(req, async () => {
    const db = await currentDb();
    const shopId = currentShopId();
    const settings = await settingsRepo.getAll();
    const nearExpiryDays = Number(settings.nearExpiryDays || 30);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
    const yearStart = new Date(todayStart.getFullYear(), 0, 1);

    const todaySales = (await db
      .prepare<{ total: number; count: number }>(
        "SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS count FROM bills WHERE shop_id = ? AND created_at >= ? AND status != 'RETURNED'"
      )
      .get(shopId, todayStart.toISOString()))!;

    const monthlySales = (await db
      .prepare<{ total: number; count: number }>(
        "SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS count FROM bills WHERE shop_id = ? AND created_at >= ? AND status != 'RETURNED'"
      )
      .get(shopId, monthStart.toISOString()))!;

    const yearlySales = (await db
      .prepare<{ total: number }>("SELECT COALESCE(SUM(total),0) AS total FROM bills WHERE shop_id = ? AND created_at >= ? AND status != 'RETURNED'")
      .get(shopId, yearStart.toISOString()))!;

    const totalUdhaar = (await db.prepare<{ total: number }>('SELECT COALESCE(SUM(balance),0) AS total FROM customers WHERE shop_id = ?').get(shopId))!;
    const totalPayables = (await db.prepare<{ total: number }>('SELECT COALESCE(SUM(balance),0) AS total FROM suppliers WHERE shop_id = ?').get(shopId))!;
    const totalItems = (await db.prepare<{ c: number }>('SELECT COUNT(*) AS c FROM items WHERE shop_id = ?').get(shopId))!;

    const lowStockItems = await itemsRepo.lowStock();
    const expiringBatches = await itemsRepo.expiringBatches(nearExpiryDays);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const dailyChart = await db
      .prepare(
        `SELECT date(created_at) AS _id, COALESCE(SUM(total),0) AS total, COUNT(*) AS count
         FROM bills WHERE shop_id = ? AND created_at >= ? AND status != 'RETURNED'
         GROUP BY date(created_at) ORDER BY _id ASC`
      )
      .all(shopId, sevenDaysAgo.toISOString());

    const topItems = await db
      .prepare(
        `SELECT bi.name, SUM(bi.quantity) AS totalQty, SUM(bi.total) AS totalRevenue
         FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
         WHERE b.shop_id = ? AND b.created_at >= ? AND b.status != 'RETURNED'
         GROUP BY bi.name ORDER BY totalRevenue DESC LIMIT 5`
      )
      .all(shopId, monthStart.toISOString());

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
