import { NextRequest, NextResponse } from 'next/server';
import { settingsRepo } from '@/lib/repo';
import { withAuth, withAdminAuth } from '@/lib/api-auth';

export async function GET(req: NextRequest) {
  return withAuth(req, async () => NextResponse.json(await settingsRepo.getAll()));
}

export async function PUT(req: NextRequest) {
  return withAdminAuth(req, async () => {
    const body = await req.json();
    return NextResponse.json(await settingsRepo.update(body));
  });
}
