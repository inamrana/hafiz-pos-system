import { NextRequest, NextResponse } from 'next/server';
import { returnsRepo, billsRepo } from '@/lib/repo';
import { withAuth } from '@/lib/api-auth';

export async function POST(req: NextRequest) {
  return withAuth(req, async ({ user }) => {
    const body = await req.json();
    if (!body.billId || !body.lines || body.lines.length === 0) {
      return NextResponse.json({ error: 'Select at least one item to return' }, { status: 400 });
    }
    try {
      const returnId = returnsRepo.create({
        billId: Number(body.billId),
        lines: body.lines,
        refundMethod: body.refundMethod === 'UDHAAR_ADJUST' ? 'UDHAAR_ADJUST' : 'CASH',
        notes: body.notes || '',
        cashierId: user.id,
      });
      const bill = billsRepo.getById(Number(body.billId));
      return NextResponse.json({ returnId, bill }, { status: 201 });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to process return';
      return NextResponse.json({ error: message }, { status: 400 });
    }
  });
}
