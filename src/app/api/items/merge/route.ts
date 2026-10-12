import { NextRequest, NextResponse } from 'next/server';
import { itemsRepo } from '@/lib/repo';
import { withAuth } from '@/lib/api-auth';

/** Folds duplicate item `sourceId` into `targetId` (history + stock move over, duplicate is removed). */
export async function POST(req: NextRequest) {
  return withAuth(req, async () => {
    const { sourceId, targetId } = await req.json();
    try {
      return NextResponse.json(await itemsRepo.merge(Number(sourceId), Number(targetId)));
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to merge items' }, { status: 400 });
    }
  });
}
