import { NextRequest, NextResponse } from 'next/server';
import { getSession } from './auth';
import { withTenant } from './tenant-context';
import { usersRepo } from './repo';
import type { PublicUser } from './models';

interface AuthedContext {
  user: PublicUser;
  shopId: number;
}

/**
 * Resolves the caller's session, opens their shop's database for the duration of `fn`,
 * and passes in the authenticated shop-local user. Returns a 401 response automatically
 * if there's no valid session (or the user was deactivated) — every data-touching route
 * needs this, since there's no "default" database anymore without a resolved shop.
 */
export async function withAuth(
  req: NextRequest,
  fn: (ctx: AuthedContext) => Promise<NextResponse> | NextResponse
): Promise<NextResponse> {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return withTenant(session.shopId, async () => {
    const user = await usersRepo.getById(session.userId);
    if (!user || !user.active) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return fn({ user, shopId: session.shopId });
  });
}

/** Same as withAuth, but also requires the ADMIN role. */
export async function withAdminAuth(
  req: NextRequest,
  fn: (ctx: AuthedContext) => Promise<NextResponse> | NextResponse
): Promise<NextResponse> {
  return withAuth(req, (ctx) => {
    if (ctx.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    return fn(ctx);
  });
}
