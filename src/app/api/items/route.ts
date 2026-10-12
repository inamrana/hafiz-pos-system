// ── ITEMS API ─────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { itemsRepo, DuplicateItemError } from '@/lib/repo';
import { withAuth } from '@/lib/api-auth';

function errorResponse(e: unknown, fallback: string) {
  if (e instanceof DuplicateItemError) {
    return NextResponse.json({ error: e.message, existing: e.existing }, { status: 409 });
  }
  if (e instanceof Error && e.message.includes('UNIQUE')) {
    return NextResponse.json({ error: 'Barcode already belongs to another item' }, { status: 409 });
  }
  return NextResponse.json({ error: e instanceof Error ? e.message : fallback }, { status: 400 });
}

export async function GET(req: NextRequest) {
  return withAuth(req, async () => {
    const params = req.nextUrl.searchParams;
    const barcode = params.get('barcode');
    if (barcode) {
      const item = await itemsRepo.getByBarcode(barcode);
      return NextResponse.json(item || null);
    }
    if (params.get('duplicates')) return NextResponse.json(await itemsRepo.duplicates());
    const id = params.get('id');
    if (id) {
      if (params.get('history')) return NextResponse.json(await itemsRepo.history(Number(id)));
      return NextResponse.json((await itemsRepo.getById(Number(id))) || null);
    }
    return NextResponse.json(await itemsRepo.search(params.get('q') || ''));
  });
}

export async function POST(req: NextRequest) {
  return withAuth(req, async () => {
    const body = await req.json();
    if (!body.name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    try {
      const item = await itemsRepo.create(body, { action: body._import ? 'IMPORT' : 'ITEM_CREATE', reference: body._import ? 'Excel import' : undefined });
      return NextResponse.json(item, { status: 201 });
    } catch (e) {
      return errorResponse(e, 'Failed to create item');
    }
  });
}

/** Edits item details. Quantity in the body is ignored — use /api/items/adjust for stock changes. */
export async function PUT(req: NextRequest) {
  return withAuth(req, async () => {
    const body = await req.json();
    const { id, _id, quantity: _quantity, _import, ...rest } = body;
    const itemId = Number(id ?? _id);
    try {
      const item = await itemsRepo.update(itemId, rest, { action: _import ? 'IMPORT' : 'ITEM_EDIT', reference: _import ? 'Excel import' : undefined });
      if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 });
      return NextResponse.json(item);
    } catch (e) {
      return errorResponse(e, 'Failed to save item');
    }
  });
}

export async function DELETE(req: NextRequest) {
  return withAuth(req, async () => {
    const id = Number(req.nextUrl.searchParams.get('id'));
    try {
      return NextResponse.json({ success: true, ...(await itemsRepo.remove(id)) });
    } catch (e) {
      return errorResponse(e, 'Failed to delete item');
    }
  });
}
