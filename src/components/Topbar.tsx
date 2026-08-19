'use client';

import { useRouter } from 'next/navigation';
import { LogOut, UserCircle } from 'lucide-react';

export default function Topbar({ name, role }: { name: string; role: string }) {
  const router = useRouter();

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  };

  return (
    <div className="no-print flex items-center justify-end gap-3 px-6 py-2.5 bg-white border-b border-slate-200">
      <div className="flex items-center gap-2 text-sm text-slate-600">
        <UserCircle size={18} className="text-slate-400" />
        <span className="font-semibold">{name}</span>
        <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-medium">{role}</span>
      </div>
      <button
        onClick={logout}
        className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-red-600 transition-colors px-2.5 py-1.5 rounded-lg hover:bg-red-50"
      >
        <LogOut size={14} /> Logout
      </button>
    </div>
  );
}
