import { NextRequest, NextResponse } from 'next/server';
import { reportsRepo } from '@/lib/repo';
import { withAuth } from '@/lib/api-auth';
import { shopToday } from '@/lib/utils';

export async function GET(req: NextRequest) {
  return withAuth(req, async () => {
    const date = req.nextUrl.searchParams.get('date') || shopToday();
    return NextResponse.json(await reportsRepo.daily(date));
  });
}
