import { NextRequest, NextResponse } from 'next/server';
import { reportsRepo } from '@/lib/repo';
import { withAuth } from '@/lib/api-auth';

export async function GET(req: NextRequest) {
  return withAuth(req, () => NextResponse.json(reportsRepo.monthly(12)));
}
