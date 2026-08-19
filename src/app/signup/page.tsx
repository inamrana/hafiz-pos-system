'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Store, Copy, Check, ArrowRight } from 'lucide-react';

const emptyForm = { shopName: '', ownerName: '', ownerEmail: '', username: '', password: '', confirmPassword: '' };

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [shopCode, setShopCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Signup failed');
        return;
      }
      setShopCode(data.shopCode);
    } finally {
      setLoading(false);
    }
  };

  const copyCode = () => {
    if (!shopCode) return;
    navigator.clipboard.writeText(shopCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (shopCode) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
          <div className="w-14 h-14 bg-green-600 rounded-2xl flex items-center justify-center text-white mb-4 mx-auto">
            <Check size={28} />
          </div>
          <h1 className="text-xl font-bold text-slate-800">Your shop is ready!</h1>
          <p className="text-sm text-slate-500 mt-1 mb-5">Save this Shop Code — you and your staff need it every time you log in.</p>
          <button
            onClick={copyCode}
            className="w-full flex items-center justify-center gap-3 bg-slate-900 text-white rounded-xl py-4 mb-2 font-mono text-2xl font-black tracking-[0.3em] hover:bg-slate-800 transition-colors"
          >
            {shopCode}
            {copied ? <Check size={20} className="text-green-400" /> : <Copy size={18} className="text-slate-400" />}
          </button>
          <p className="text-xs text-slate-400 mb-6">{copied ? 'Copied!' : 'Click to copy'}</p>
          <button
            onClick={() => { router.replace('/'); router.refresh(); }}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-xl transition-colors"
          >
            Continue to Dashboard <ArrowRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-slate-200 p-8">
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center text-white mb-3">
            <Store size={28} />
          </div>
          <h1 className="text-xl font-bold text-slate-800">Create Your Shop</h1>
          <p className="text-sm text-slate-400 mt-1">Set up your own Mart POS in a minute</p>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Shop Name</label>
            <input autoFocus value={form.shopName} onChange={(e) => setForm({ ...form, shopName: e.target.value })} placeholder="My Grocery Mart" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Your Name</label>
            <input value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Email</label>
            <input type="email" value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Admin Username</label>
              <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Password</label>
              <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Confirm Password</label>
            <input type="password" value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          {error && <p className="text-red-600 text-sm font-medium">{error}</p>}
          <button
            type="submit"
            disabled={loading || !form.shopName || !form.ownerName || !form.ownerEmail || !form.username || !form.password}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-semibold py-2.5 rounded-xl transition-colors mt-2"
          >
            {loading ? 'Creating your shop...' : 'Create Shop'}
          </button>
        </form>
        <p className="text-sm text-slate-500 text-center mt-5">
          Already have a shop? <Link href="/login" className="text-blue-600 font-semibold hover:underline">Log in</Link>
        </p>
      </div>
    </div>
  );
}
