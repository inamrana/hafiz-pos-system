import { NextRequest, NextResponse } from 'next/server';

/**
 * Single-user app — no session/tenant to resolve. Kept as a thin wrapper so
 * route handlers have one consistent shape, in case auth is ever reintroduced.
 */
export async function withAuth(
  req: NextRequest,
  fn: () => Promise<NextResponse> | NextResponse
): Promise<NextResponse> {
  return fn();
}

export const withAdminAuth = withAuth;
