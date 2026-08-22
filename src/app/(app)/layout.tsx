import { settingsRepo } from '@/lib/repo';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const settings = await settingsRepo.getAll();

  return (
    <div className="flex min-h-screen">
      <Sidebar shopName={settings.shopName || 'Hafiz Stationers'} />
      <div className="flex-1 flex flex-col overflow-auto">
        <Topbar />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
