import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getPlatformSecret } from './platform-db';

export const SESSION_COOKIE = 'hp_session';

/** Shared cookie options for setting the session cookie — `secure` only in production so local HTTP dev still works. */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 60 * 60 * 24 * 30,
};

export async function setSessionCookie(res: NextResponse, shopId: number, userId: number) {
  const token = await createSessionToken(shopId, userId);
  res.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
}

export interface Session {
  shopId: number;
  userId: number;
}

async function sign(payload: string): Promise<string> {
  const secret = await getPlatformSecret();
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export async function createSessionToken(shopId: number, userId: number): Promise<string> {
  const payload = JSON.stringify({ shopId, userId, ts: Date.now() });
  const encoded = Buffer.from(payload).toString('base64url');
  const sig = await sign(encoded);
  return `${encoded}.${sig}`;
}

async function verifySessionToken(token: string): Promise<Session | null> {
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;
  const expected = await sign(encoded);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString());
    if (typeof payload.shopId !== 'number' || typeof payload.userId !== 'number') return null;
    return { shopId: payload.shopId, userId: payload.userId };
  } catch {
    return null;
  }
}

export async function getSession(req: NextRequest): Promise<Session | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  return token ? verifySessionToken(token) : null;
}

/** Same as getSession, but for use in React Server Components / layouts. */
export async function getSessionFromCookies(): Promise<Session | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  return token ? verifySessionToken(token) : null;
}
