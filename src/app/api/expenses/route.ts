import { NextRequest, NextResponse } from 'next/server';
import { expensesRepo, EXPENSE_CATEGORIES } from '@/lib/repo';
import { withAuth } from '@/lib/api-auth';
import { shopToday } from '@/lib/utils';

export async function GET(req: NextRequest) {
  return withAuth(req, async () => {
    const today = shopToday();
    const from = req.nextUrl.searchParams.get('from') || today;
    const to = req.nextUrl.searchParams.get('to') || today;
    return NextResponse.json({ ...(await expensesRepo.list(from, to)), categories: EXPENSE_CATEGORIES });
  });
}

export async function POST(req: NextRequest) {
  return withAuth(req, async () => {
    const body = await req.json();
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'Enter an amount' }, { status: 400 });
    const expense = await expensesRepo.create({
      category: body.category || 'Other',
      description: body.description || '',
      amount,
      paymentMethod: body.paymentMethod || 'CASH',
      date: /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : shopToday(),
    });
    return NextResponse.json(expense, { status: 201 });
  });
}

export async function DELETE(req: NextRequest) {
  return withAuth(req, async () => {
    await expensesRepo.remove(Number(req.nextUrl.searchParams.get('id')));
    return NextResponse.json({ success: true });
  });
}
