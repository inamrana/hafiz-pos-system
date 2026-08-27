import { NextRequest, NextResponse } from 'next/server';
import { reportsRepo } from '@/lib/repo';
import { withAuth } from '@/lib/api-auth';

export async function GET(req: NextRequest) {
  return withAuth(req, async () => {
    const from = req.nextUrl.searchParams.get('from') || undefined;
    const to = req.nextUrl.searchParams.get('to') || undefined;
    return NextResponse.json(await reportsRepo.products({ from, to }));
  });
}
