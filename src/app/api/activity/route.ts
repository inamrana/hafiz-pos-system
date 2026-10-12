import { NextRequest, NextResponse } from 'next/server';
import { activityRepo } from '@/lib/repo';
import { withAuth } from '@/lib/api-auth';

export async function GET(req: NextRequest) {
  return withAuth(req, async () => {
    const p = req.nextUrl.searchParams;
    return NextResponse.json(
      await activityRepo.list({
        from: p.get('from') || undefined,
        to: p.get('to') || undefined,
        group: p.get('group') || undefined,
        q: p.get('q') || undefined,
        limit: Number(p.get('limit') || 1000),
      })
    );
  });
}
