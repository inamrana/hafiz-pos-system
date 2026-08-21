import { NextRequest, NextResponse } from 'next/server';
import { suppliersRepo } from '@/lib/repo';
import { withAuth } from '@/lib/api-auth';

export async function GET(req: NextRequest) {
  return withAuth(req, async () => {
    const q = req.nextUrl.searchParams.get('q') || '';
    const id = req.nextUrl.searchParams.get('id');
    if (id) {
      const supplier = await suppliersRepo.getById(Number(id));
      return NextResponse.json(supplier ? { ...supplier, ledger: await suppliersRepo.ledger(supplier.id) } : null);
    }
    return NextResponse.json(await suppliersRepo.search(q));
  });
}

export async function POST(req: NextRequest) {
  return withAuth(req, async () => {
    const body = await req.json();
    if (!body.name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    const supplier = await suppliersRepo.create(body);
    return NextResponse.json(supplier, { status: 201 });
  });
}

// Log a payment to supplier (reduce payable)
export async function PUT(req: NextRequest) {
  return withAuth(req, async () => {
    const { supplierId, amount, notes } = await req.json();
    const supplier = await suppliersRepo.logPayment(Number(supplierId), Number(amount), notes);
    return NextResponse.json(supplier);
  });
}
