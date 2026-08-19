import { redirect } from 'next/navigation';
import { getSessionFromCookies } from '@/lib/auth';
import { withTenant } from '@/lib/tenant-context';
import { settingsRepo, usersRepo } from '@/lib/repo';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionFromCookies();
  if (!session) redirect('/login');

  const data = await withTenant(session.shopId, () => {
    const user = usersRepo.getById(session.userId);
    if (!user || !user.active) return null;
    return { user, settings: settingsRepo.getAll() };
  });

  if (!data) redirect('/login');
  const { user, settings } = data;

  return (
    <div className="flex min-h-screen">
      <Sidebar shopName={settings.shopName || 'Mart POS'} role={user.role} />
      <div className="flex-1 flex flex-col overflow-auto">
        <Topbar name={user.name} role={user.role} />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
