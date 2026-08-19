'use client';

import { useEffect, useState } from 'react';
import { Plus, X, KeyRound, UserX, UserCheck } from 'lucide-react';

interface UserRow {
  id: number;
  username: string;
  name: string;
  role: 'ADMIN' | 'CASHIER';
  active: number;
}

const emptyForm = { username: '', password: '', name: '', role: 'CASHIER' as 'ADMIN' | 'CASHIER' };

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const load = async () => {
    const res = await fetch('/api/users');
    if (res.ok) setUsers(await res.json());
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to create user');
        return;
      }
      setShowModal(false);
      setForm(emptyForm);
      load();
    } finally {
      setLoading(false);
    }
  };

  const toggleActive = async (u: UserRow) => {
    await fetch('/api/users', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: u.id, active: !u.active }),
    });
    load();
  };

  const resetPassword = async () => {
    if (!resetTarget || !newPassword) return;
    await fetch('/api/users', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: resetTarget.id, password: newPassword }),
    });
    setResetTarget(null);
    setNewPassword('');
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Cashiers & Users</h1>
          <p className="text-slate-500 text-sm mt-0.5">Manage staff accounts and access</p>
        </div>
        <button onClick={() => { setForm(emptyForm); setError(''); setShowModal(true); }} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl font-semibold transition-colors">
          <Plus size={18} /> Add User
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-5 py-3 text-left text-xs font-bold text-slate-500 uppercase">Name</th>
              <th className="px-5 py-3 text-left text-xs font-bold text-slate-500 uppercase">Username</th>
              <th className="px-5 py-3 text-left text-xs font-bold text-slate-500 uppercase">Role</th>
              <th className="px-5 py-3 text-center text-xs font-bold text-slate-500 uppercase">Status</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-5 py-3.5 font-semibold text-sm">{u.name}</td>
                <td className="px-5 py-3.5 text-sm text-slate-500">{u.username}</td>
                <td className="px-5 py-3.5">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${u.role === 'ADMIN' ? 'bg-purple-100 text-purple-700' : 'bg-blue-50 text-blue-700'}`}>{u.role}</span>
                </td>
                <td className="px-5 py-3.5 text-center">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${u.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>{u.active ? 'Active' : 'Disabled'}</span>
                </td>
                <td className="px-5 py-3.5">
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setResetTarget(u)} className="text-slate-400 hover:text-blue-600" title="Reset password"><KeyRound size={15} /></button>
                    <button onClick={() => toggleActive(u)} className="text-slate-400 hover:text-red-600" title={u.active ? 'Disable' : 'Enable'}>
                      {u.active ? <UserX size={15} /> : <UserCheck size={15} />}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h2 className="text-lg font-bold">Add User</h2>
              <button onClick={() => setShowModal(false)}><X size={20} className="text-slate-400" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Full Name</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Username</label>
                <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Password</label>
                <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Role</label>
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'ADMIN' | 'CASHIER' })} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="CASHIER">Cashier</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </div>
              {error && <p className="text-red-600 text-sm font-medium">{error}</p>}
            </div>
            <div className="flex gap-3 p-6 pt-0">
              <button onClick={() => setShowModal(false)} className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl font-semibold hover:bg-slate-50">Cancel</button>
              <button onClick={save} disabled={loading || !form.username || !form.password || !form.name} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white py-2.5 rounded-xl font-semibold">
                {loading ? 'Saving...' : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      )}

      {resetTarget && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h2 className="text-lg font-bold">Reset Password — {resetTarget.name}</h2>
              <button onClick={() => setResetTarget(null)}><X size={20} className="text-slate-400" /></button>
            </div>
            <div className="p-6">
              <input autoFocus type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="New password" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex gap-3 p-6 pt-0">
              <button onClick={() => setResetTarget(null)} className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl font-semibold hover:bg-slate-50">Cancel</button>
              <button onClick={resetPassword} disabled={!newPassword} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white py-2.5 rounded-xl font-semibold">Update</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
