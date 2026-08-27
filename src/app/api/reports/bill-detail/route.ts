import { NextRequest, NextResponse } from 'next/server';
import { reportsRepo } from '@/lib/repo';
import { withAuth } from '@/lib/api-auth';

export async function GET(req: NextRequest) {
  return withAuth(req, async () => {
    const id = Number(req.nextUrl.searchParams.get('id'));
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    const detail = await reportsRepo.billDetail(id);
    if (!detail) return NextResponse.json({ error: 'Bill not found' }, { status: 404 });
    return NextResponse.json(detail);
  });
}
