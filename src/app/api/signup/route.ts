import { NextRequest, NextResponse } from 'next/server';
import { shopsRepo } from '@/lib/platform-db';
import { withTenant } from '@/lib/tenant-context';
import { usersRepo, settingsRepo } from '@/lib/repo';
import { setSessionCookie } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { shopName, ownerName, ownerEmail, username, password } = body;

  if (!shopName?.trim() || !ownerName?.trim() || !ownerEmail?.trim() || !username?.trim() || !password) {
    return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
  }
  if (String(password).length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
  }

  const shop = shopsRepo.create({ name: shopName.trim(), ownerName: ownerName.trim(), ownerEmail: ownerEmail.trim() });

  try {
    const user = await withTenant(shop.id, () => {
      settingsRepo.update({ shopName: shopName.trim() });
      return usersRepo.create({ username: username.trim(), password, name: ownerName.trim(), role: 'ADMIN' });
    });

    const res = NextResponse.json({ shopCode: shop.shop_code, user }, { status: 201 });
    setSessionCookie(res, shop.id, user.id);
    return res;
  } catch {
    return NextResponse.json({ error: 'That username is already taken' }, { status: 409 });
  }
}
