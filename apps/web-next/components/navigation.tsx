'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { buildNavigation } from '@atlas/ui/contracts';
import { layout, nav, typography } from '@atlas/ui/styles';

export function Navigation() {
  const pathname = usePathname();
  const { items, logoText } = buildNavigation(pathname);

  return (
    <header className={nav.header}>
      <nav className={layout.container}>
        <div className={nav.headerInner}>
          <Link href="/" className={nav.logo}>
            <span className={nav.logoAccent}>{logoText}</span>
          </Link>

          <ul className={nav.navList}>
            {items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={item.isActive ? nav.navItemActive : nav.navItem}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>

          <button className={nav.mobileMenuBtn}>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </nav>
    </header>
  );
}
