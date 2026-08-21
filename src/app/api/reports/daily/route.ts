import { NextRequest, NextResponse } from 'next/server';
import { reportsRepo } from '@/lib/repo';
import { withAuth } from '@/lib/api-auth';

export async function GET(req: NextRequest) {
  return withAuth(req, async () => {
    const date = req.nextUrl.searchParams.get('date') || new Date().toISOString().slice(0, 10);
    return NextResponse.json(await reportsRepo.daily(date));
  });
}
