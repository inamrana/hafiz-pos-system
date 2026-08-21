import { NextRequest, NextResponse } from 'next/server';
import { billsRepo } from '@/lib/repo';
import { withAuth } from '@/lib/api-auth';

export async function GET(req: NextRequest) {
  return withAuth(req, async () => {
    const limit = Number(req.nextUrl.searchParams.get('limit') || 200);
    const from = req.nextUrl.searchParams.get('from') || undefined;
    const to = req.nextUrl.searchParams.get('to') || undefined;
    const type = req.nextUrl.searchParams.get('type') || undefined;
    const number = req.nextUrl.searchParams.get('number');
    if (number) {
      const bill = await billsRepo.getByNumber(number);
      return NextResponse.json(bill || null);
    }
    return NextResponse.json(await billsRepo.list({ limit, from, to, type }));
  });
}

export async function POST(req: NextRequest) {
  return withAuth(req, async ({ user }) => {
    const body = await req.json();
    const { items, discount, paymentType, customerId, customerName } = body;

    if (!items || items.length === 0) {
      return NextResponse.json({ error: 'Bill must contain at least one item' }, { status: 400 });
    }
    if (paymentType === 'UDHAAR' && !customerId) {
      return NextResponse.json({ error: 'Customer is required for Udhaar payment' }, { status: 400 });
    }

    const bill = await billsRepo.create({
      items,
      discount: discount || 0,
      paymentType,
      customerId: customerId || null,
      customerName: customerName || 'Walk-in Customer',
      cashierId: user.id,
      cashierName: user.name,
    });

    return NextResponse.json(bill, { status: 201 });
  });
}
