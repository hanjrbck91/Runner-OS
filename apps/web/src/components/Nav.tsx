'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS: Array<{ href: string; label: string }> = [
  { href: '/today', label: 'TODAY' },
  { href: '/log', label: 'LOG' },
  { href: '/week', label: 'WEEK' },
  { href: '/plan', label: 'PLAN' },
];

export function Nav() {
  const path = usePathname();
  // section marker lets the Log page recolour its own nav active-state (no teal)
  // without a :has() rule; every other page renders exactly as before.
  const section = (path ?? '').split('/')[1] ?? '';
  return (
    <nav className="nav" data-section={section} aria-label="primary">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href}>
          <button className={path === t.href ? 'active' : ''} data-tab={t.label}>{t.label}</button>
        </Link>
      ))}
    </nav>
  );
}
