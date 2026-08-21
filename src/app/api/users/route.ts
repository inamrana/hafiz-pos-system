import { NextRequest, NextResponse } from 'next/server';
import { usersRepo } from '@/lib/repo';
import { withAdminAuth } from '@/lib/api-auth';

export async function GET(req: NextRequest) {
  return withAdminAuth(req, async () => NextResponse.json(await usersRepo.list()));
}

export async function POST(req: NextRequest) {
  return withAdminAuth(req, async () => {
    const body = await req.json();
    if (!body.username || !body.password || !body.name) {
      return NextResponse.json({ error: 'Username, password and name are required' }, { status: 400 });
    }
    try {
      const user = await usersRepo.create({
        username: body.username,
        password: body.password,
        name: body.name,
        role: body.role === 'ADMIN' ? 'ADMIN' : 'CASHIER',
      });
      return NextResponse.json(user, { status: 201 });
    } catch {
      return NextResponse.json({ error: 'Username already exists' }, { status: 409 });
    }
  });
}

export async function PUT(req: NextRequest) {
  return withAdminAuth(req, async () => {
    const body = await req.json();
    if (typeof body.active === 'boolean') await usersRepo.setActive(body.id, body.active);
    if (body.password) await usersRepo.resetPassword(body.id, body.password);
    return NextResponse.json(await usersRepo.getById(body.id));
  });
}
