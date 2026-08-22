import { NextRequest, NextResponse } from 'next/server';
import { purchasesRepo } from '@/lib/repo';
import { withAuth } from '@/lib/api-auth';

export async function GET(req: NextRequest) {
  return withAuth(req, async () => {
    const limit = Number(req.nextUrl.searchParams.get('limit') || 100);
    const id = req.nextUrl.searchParams.get('id');
    if (id) return NextResponse.json(await purchasesRepo.getById(Number(id)));
    return NextResponse.json(await purchasesRepo.list(limit));
  });
}

export async function POST(req: NextRequest) {
  return withAuth(req, async () => {
    const body = await req.json();
    if (!body.items || body.items.length === 0) {
      return NextResponse.json({ error: 'Purchase must contain at least one item' }, { status: 400 });
    }
    const purchase = await purchasesRepo.create({
      supplierId: body.supplierId || null,
      supplierName: body.supplierName || 'Unknown Supplier',
      paymentType: body.paymentType === 'CREDIT' ? 'CREDIT' : 'CASH',
      items: body.items,
    });
    return NextResponse.json(purchase, { status: 201 });
  });
}
