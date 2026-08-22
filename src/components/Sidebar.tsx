'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  BookOpen,
  Receipt,
  Store,
  AlertTriangle,
  Truck,
  Settings as SettingsIcon,
  Building2,
  Menu,
  CalendarDays,
  CalendarRange,
  TrendingUp,
  Boxes,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const mainItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/billing', label: 'Billing', icon: ShoppingCart },
  { href: '/stock', label: 'Stock', icon: Package },
  { href: '/stock?filter=low', label: 'Low Stock', icon: AlertTriangle },
  { href: '/purchases', label: 'Purchases', icon: Truck },
  { href: '/suppliers', label: 'Suppliers', icon: Building2 },
  { href: '/udhaar', label: 'Udhaar Khaata', icon: BookOpen },
  { href: '/reports', label: 'Bills', icon: Receipt },
];

const reportItems = [
  { href: '/reports/daily', label: 'Daily Report', icon: CalendarDays },
  { href: '/reports/monthly', label: 'Monthly Report', icon: CalendarRange },
  { href: '/reports/yearly', label: 'Yearly Report', icon: TrendingUp },
  { href: '/reports/inventory', label: 'Inventory Report', icon: Boxes },
];

const bottomItems = [
  { href: '/settings', label: 'Settings', icon: SettingsIcon },
];

const STORAGE_KEY = 'hp_sidebar_expanded';

export default function Sidebar({ shopName }: { shopName: string }) {
  const pathname = usePathname();
  const [currentUrl, setCurrentUrl] = useState('');
  // Closed by default — only the toggle button (or a nav click) reveals labels.
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setCurrentUrl(window.location.pathname + window.location.search);
    }
  }, [pathname]);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) setExpanded(stored === 'true');
  }, []);

  const toggle = () => {
    setExpanded((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  };

  const isActive = (href: string) => (currentUrl ? currentUrl === href : pathname === href);

  const renderLink = ({ href, label, icon: Icon }: { href: string; label: string; icon: typeof LayoutDashboard }) => (
    <Link
      key={href}
      href={href}
      title={expanded ? undefined : label}
      className={cn(
        'flex items-center gap-3 px-3.5 py-3 rounded-lg text-sm font-medium transition-all',
        !expanded && 'justify-center px-0',
        isActive(href)
          ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40'
          : 'text-slate-400 hover:bg-slate-800 hover:text-white'
      )}
    >
      <Icon size={18} className="flex-shrink-0" />
      {expanded && <span className="truncate">{label}</span>}
    </Link>
  );

  return (
    <aside
      className={cn(
        'no-print bg-slate-900 text-white flex flex-col h-screen sticky top-0 flex-shrink-0 transition-[width] duration-200 ease-in-out',
        expanded ? 'w-64' : 'w-[72px]'
      )}
    >
      {/* Logo / toggle */}
      <div className="p-3 border-b border-slate-700">
        <div className={cn('flex items-center gap-3', !expanded && 'flex-col')}>
          <button
            onClick={toggle}
            title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
            className="w-9 h-9 bg-blue-500 hover:bg-blue-400 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors"
          >
            {expanded ? <Menu size={20} /> : <Store size={20} />}
          </button>
          {expanded && (
            <p className="font-bold text-sm leading-tight truncate">{shopName}</p>
          )}
        </div>
        {!expanded && (
          <button
            onClick={toggle}
            title="Expand sidebar"
            className="mt-2 w-full flex items-center justify-center text-slate-500 hover:text-white transition-colors"
          >
            <Menu size={16} />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto overflow-x-hidden">
        {mainItems.map(renderLink)}

        <div className={cn('pt-3 mt-2 border-t border-slate-800', expanded ? 'px-3.5' : 'flex justify-center')}>
          {expanded ? (
            <p className="text-[10px] font-bold tracking-wider text-slate-500 uppercase">Reports</p>
          ) : (
            <div className="w-6 border-t border-slate-700" />
          )}
        </div>
        {reportItems.map(renderLink)}

        {bottomItems.map(renderLink)}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-slate-700">
        <p className="text-xs text-slate-500 text-center">{expanded ? 'Hafiz Stationers POS' : 'POS'}</p>
      </div>
    </aside>
  );
}
