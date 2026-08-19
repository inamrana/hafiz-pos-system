import { NextRequest, NextResponse } from 'next/server';
import { customersRepo } from '@/lib/repo';
import { withAuth } from '@/lib/api-auth';

export async function GET(req: NextRequest) {
  return withAuth(req, () => {
    const q = req.nextUrl.searchParams.get('q') || '';
    return NextResponse.json(customersRepo.search(q));
  });
}

export async function POST(req: NextRequest) {
  return withAuth(req, async () => {
    const body = await req.json();
    if (!body.name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    const customer = customersRepo.create(body);
    return NextResponse.json(customer, { status: 201 });
  });
}

// Log a payment
export async function PUT(req: NextRequest) {
  return withAuth(req, async () => {
    const { customerId, amount, notes } = await req.json();
    const customer = customersRepo.logPayment(Number(customerId), Number(amount), notes);
    return NextResponse.json(customer);
  });
}
