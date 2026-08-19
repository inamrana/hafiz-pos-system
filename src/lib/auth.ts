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

export function setSessionCookie(res: NextResponse, shopId: number, userId: number) {
  res.cookies.set(SESSION_COOKIE, createSessionToken(shopId, userId), SESSION_COOKIE_OPTIONS);
}

export interface Session {
  shopId: number;
  userId: number;
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', getPlatformSecret()).update(payload).digest('hex');
}

export function createSessionToken(shopId: number, userId: number): string {
  const payload = JSON.stringify({ shopId, userId, ts: Date.now() });
  const encoded = Buffer.from(payload).toString('base64url');
  const sig = sign(encoded);
  return `${encoded}.${sig}`;
}

function verifySessionToken(token: string): Session | null {
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;
  const expected = sign(encoded);
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

/** Pure — verifies the session cookie without touching any shop database. */
export function getSession(req: NextRequest): Session | null {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  return token ? verifySessionToken(token) : null;
}

/** Same as getSession, but for use in React Server Components / layouts. */
export async function getSessionFromCookies(): Promise<Session | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  return token ? verifySessionToken(token) : null;
}
