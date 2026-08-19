'use client';

import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';

const fields: { key: string; label: string; placeholder?: string }[] = [
  { key: 'shopName', label: 'Shop Name', placeholder: 'My Grocery Mart' },
  { key: 'address', label: 'Address', placeholder: 'Street, City' },
  { key: 'phone', label: 'Phone', placeholder: '03xx-xxxxxxx' },
  { key: 'currencySymbol', label: 'Currency Symbol', placeholder: 'Rs.' },
  { key: 'lowStockThreshold', label: 'Default Low Stock Threshold', placeholder: '5' },
  { key: 'nearExpiryDays', label: 'Near-Expiry Alert Window (days)', placeholder: '30' },
  { key: 'receiptFooter', label: 'Receipt Footer Message', placeholder: 'Thank you for shopping with us!' },
];

export default function SettingsPage() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then(setValues);
  }, []);

  const save = async () => {
    setLoading(true);
    setSaved(false);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Shop Settings</h1>
        <p className="text-slate-500 text-sm mt-0.5">Configure your shop profile, used on receipts and reports</p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
        {fields.map((f) => (
          <div key={f.key}>
            <label className="block text-xs font-semibold text-slate-500 mb-1">{f.label}</label>
            <input
              value={values[f.key] || ''}
              onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              placeholder={f.placeholder}
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        ))}
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={save}
            disabled={loading}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white px-5 py-2.5 rounded-xl font-semibold transition-colors"
          >
            <Save size={16} /> {loading ? 'Saving...' : 'Save Settings'}
          </button>
          {saved && <span className="text-green-600 text-sm font-semibold">Saved!</span>}
        </div>
      </div>
    </div>
  );
}
