'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { buildNavigation } from '@atlas/sdk/contracts';
import { layout, nav } from '@atlas/ui/styles';
import { OrbitalLogo } from '@/components/OrbitalLogo';

export function Navigation() {
  const pathname = usePathname();
  const { items } = buildNavigation(pathname);

  return (
    <header className={nav.header}>
      <nav className={layout.container4k}>
        <div className={nav.headerInner}>
          <Link href="/" className="group flex items-center gap-3.5">
            <OrbitalLogo size={42} />
            <div className="flex flex-col gap-0.5">
              <span className="font-display font-bold text-white text-[17px] leading-none tracking-wide uppercase group-hover:text-frontend-light transition-colors">
                Engineering Atlas
              </span>
              <span className="font-mono text-[9px] text-slate-500 leading-none tracking-[0.18em] uppercase">
                Portfolio System &mdash; V1.0
              </span>
            </div>
          </Link>

          <ul className={nav.navList}>
            {items.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className={item.isActive ? nav.navItemActive : nav.navItem}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>

          <button className={nav.mobileMenuBtn}>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
        </div>
      </nav>
    </header>
  );
}
