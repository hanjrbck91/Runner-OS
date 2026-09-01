import { redirect } from 'next/navigation';
import { auth } from '../../auth.js';
import { Nav } from '../../components/Nav.js';
import { SignOut } from '../../components/SignOut.js';

/** Auth gate for the app shell. Unauthenticated users go to /signin. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.email) redirect('/signin');
  return (
    <div className="app">
      <div className="bar">
        <span className="brand">RUNNER·OS</span>
        <SignOut />
      </div>
      <div className="screen">{children}</div>
      <Nav />
    </div>
  );
}
