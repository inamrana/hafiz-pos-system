import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api-auth';

export async function GET(req: NextRequest) {
  return withAuth(req, ({ user }) => NextResponse.json({ user }));
}
