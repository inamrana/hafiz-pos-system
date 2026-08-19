import { NextRequest, NextResponse } from 'next/server';
import { shopsRepo } from '@/lib/platform-db';
import { withTenant } from '@/lib/tenant-context';
import { usersRepo } from '@/lib/repo';
import { setSessionCookie } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const { shopCode, username, password } = await req.json();
  if (!shopCode || !username || !password) {
    return NextResponse.json({ error: 'Shop code, username and password are required' }, { status: 400 });
  }

  const shop = shopsRepo.getByCode(String(shopCode));
  if (!shop) {
    return NextResponse.json({ error: 'Shop code not found' }, { status: 401 });
  }

  const user = await withTenant(shop.id, () => usersRepo.authenticate(username, password));
  if (!user) {
    return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
  }

  const res = NextResponse.json({ user, shopName: shop.name });
  setSessionCookie(res, shop.id, user.id);
  return res;
}
