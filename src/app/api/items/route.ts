// ── ITEMS API ─────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { itemsRepo } from '@/lib/repo';
import { withAuth } from '@/lib/api-auth';

export async function GET(req: NextRequest) {
  return withAuth(req, () => {
    const q = req.nextUrl.searchParams.get('q') || '';
    const barcode = req.nextUrl.searchParams.get('barcode');
    if (barcode) {
      const item = itemsRepo.getByBarcode(barcode);
      return NextResponse.json(item || null);
    }
    return NextResponse.json(itemsRepo.search(q));
  });
}

export async function POST(req: NextRequest) {
  return withAuth(req, async () => {
    const body = await req.json();
    if (!body.name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    try {
      const item = itemsRepo.create(body);
      return NextResponse.json(item, { status: 201 });
    } catch (e) {
      const message = e instanceof Error && e.message.includes('UNIQUE') ? 'Barcode already exists' : 'Failed to create item';
      return NextResponse.json({ error: message }, { status: 409 });
    }
  });
}

export async function PUT(req: NextRequest) {
  return withAuth(req, async () => {
    const body = await req.json();
    const { id, _id, ...rest } = body;
    const itemId = Number(id ?? _id);
    const item = itemsRepo.update(itemId, rest);
    if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    return NextResponse.json(item);
  });
}

export async function DELETE(req: NextRequest) {
  return withAuth(req, () => {
    const id = Number(req.nextUrl.searchParams.get('id'));
    itemsRepo.remove(id);
    return NextResponse.json({ success: true });
  });
}
