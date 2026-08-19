'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Store, Lock, User as UserIcon, Hash } from 'lucide-react';

const SHOP_CODE_KEY = 'hp_last_shop_code';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [shopCode, setShopCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // If a valid session already exists (as opposed to just a stale cookie),
  // skip the login form instead of making the user sign in again.
  useEffect(() => {
    fetch('/api/auth/me').then((res) => {
      if (res.ok) router.replace(params.get('next') || '/');
    });
    const remembered = localStorage.getItem(SHOP_CODE_KEY);
    if (remembered) setShopCode(remembered);
  }, [params, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopCode: shopCode.trim().toUpperCase(), username, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Login failed');
        return;
      }
      localStorage.setItem(SHOP_CODE_KEY, shopCode.trim().toUpperCase());
      router.replace(params.get('next') || '/');
      router.refresh();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-slate-200 p-8">
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center text-white mb-3">
            <Store size={28} />
          </div>
          <h1 className="text-xl font-bold text-slate-800">Mart POS Login</h1>
          <p className="text-sm text-slate-400 mt-1">Sign in to your shop</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Shop Code</label>
            <div className="relative">
              <Hash size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                value={shopCode}
                onChange={(e) => setShopCode(e.target.value.toUpperCase())}
                className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl uppercase tracking-widest font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="ABC123"
                maxLength={6}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Username</label>
            <div className="relative">
              <UserIcon size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="your username"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Password</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="••••••••"
              />
            </div>
          </div>
          {error && <p className="text-red-600 text-sm font-medium">{error}</p>}
          <button
            type="submit"
            disabled={loading || !shopCode || !username || !password}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-semibold py-2.5 rounded-xl transition-colors"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
        <p className="text-sm text-slate-500 text-center mt-6">
          New shop? <Link href="/signup" className="text-blue-600 font-semibold hover:underline">Create one</Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
