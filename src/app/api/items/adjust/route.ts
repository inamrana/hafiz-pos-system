import { NextRequest, NextResponse } from 'next/server';
import { itemsRepo } from '@/lib/repo';
import { withAuth } from '@/lib/api-auth';

/** Manual stock correction — add, remove, or set to a counted quantity, with a reason. */
export async function POST(req: NextRequest) {
  return withAuth(req, async () => {
    const body = await req.json();
    const mode = ['ADD', 'REMOVE', 'SET'].includes(body.mode) ? body.mode : null;
    if (!mode) return NextResponse.json({ error: 'Choose add, remove or set' }, { status: 400 });
    if (!body.reason?.trim()) return NextResponse.json({ error: 'A reason is required' }, { status: 400 });
    try {
      const item = await itemsRepo.adjust(Number(body.id), {
        mode,
        quantity: Number(body.quantity),
        reason: body.reason.trim(),
        notes: body.notes || '',
        action: body._import ? 'IMPORT' : 'ADJUST',
      });
      return NextResponse.json(item);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to adjust stock' }, { status: 400 });
    }
  });
}
