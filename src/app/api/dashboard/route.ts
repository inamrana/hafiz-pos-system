import { NextRequest, NextResponse } from 'next/server';
import { currentDb } from '@/lib/tenant-context';
import { itemsRepo, settingsRepo } from '@/lib/repo';
import { withAuth } from '@/lib/api-auth';

export async function GET(req: NextRequest) {
  return withAuth(req, () => {
    const db = currentDb();
    const settings = settingsRepo.getAll();
    const nearExpiryDays = Number(settings.nearExpiryDays || 30);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
    const yearStart = new Date(todayStart.getFullYear(), 0, 1);

    const todaySales = db
      .prepare("SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS count FROM bills WHERE created_at >= ? AND status != 'RETURNED'")
      .get(todayStart.toISOString()) as { total: number; count: number };

    const monthlySales = db
      .prepare("SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS count FROM bills WHERE created_at >= ? AND status != 'RETURNED'")
      .get(monthStart.toISOString()) as { total: number; count: number };

    const yearlySales = db
      .prepare("SELECT COALESCE(SUM(total),0) AS total FROM bills WHERE created_at >= ? AND status != 'RETURNED'")
      .get(yearStart.toISOString()) as { total: number };

    const totalUdhaar = db.prepare('SELECT COALESCE(SUM(balance),0) AS total FROM customers').get() as { total: number };
    const totalPayables = db.prepare('SELECT COALESCE(SUM(balance),0) AS total FROM suppliers').get() as { total: number };
    const totalItems = db.prepare('SELECT COUNT(*) AS c FROM items').get() as { c: number };

    const lowStockItems = itemsRepo.lowStock();
    const expiringBatches = itemsRepo.expiringBatches(nearExpiryDays);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const dailyChart = db
      .prepare(
        `SELECT date(created_at) AS _id, COALESCE(SUM(total),0) AS total, COUNT(*) AS count
         FROM bills WHERE created_at >= ? AND status != 'RETURNED'
         GROUP BY date(created_at) ORDER BY _id ASC`
      )
      .all(sevenDaysAgo.toISOString());

    const topItems = db
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
