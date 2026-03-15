'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const C = {
  bgDeep: '#050c18',
  textPrimary: '#f0f8ff',
  textMuted: '#6f9ab8',
  accent: '#00e5ff',
  accentDim: 'rgba(0,229,255,.12)',
  accentGlow: 'rgba(0,229,255,.18)',
  border: 'rgba(0,229,255,.13)',
  borderDim: 'rgba(0,229,255,.07)',
  surface: 'rgba(0,18,44,.7)',
} as const;

const TABS = [
  {
    label: 'Big Board',
    href: '/gridstream/draft',
    desc: 'Prospect rankings & scouting reports',
  },
  {
    label: 'Mock Drafts',
    href: '/gridstream/draft/mocks',
    desc: 'Expert picks from top analysts',
  },
];

export default function DraftLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div
      style={{
        minHeight: '100vh',
        background: C.bgDeep,
        color: C.textPrimary,
        fontFamily: 'var(--font-sans, system-ui, sans-serif)',
      }}
    >
      {/* Ambient glow */}
      <div
        className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2"
        style={{
          width: 900,
          height: 500,
          background:
            'radial-gradient(ellipse at center, rgba(0,229,255,0.055) 0%, transparent 70%)',
          filter: 'blur(40px)',
          position: 'absolute',
        }}
      />

      <div
        style={{ maxWidth: 1400, margin: '0 auto', padding: '48px 16px 0', position: 'relative' }}
      >
        {/* Breadcrumb */}
        <div style={{ marginBottom: 8 }}>
          <Link
            href="/gridstream"
            style={{
              color: C.textMuted,
              fontSize: 12,
              textDecoration: 'none',
              fontFamily: 'monospace',
            }}
          >
            GRIDSTREAM
          </Link>
          <span style={{ color: C.textMuted, fontSize: 12, margin: '0 6px' }}>/</span>
          <span style={{ color: C.accent, fontSize: 12, fontFamily: 'monospace' }}>DRAFT</span>
        </div>

        {/* Page title */}
        <h1
          style={{
            fontSize: 'clamp(24px, 4vw, 40px)',
            fontWeight: 800,
            letterSpacing: '-0.02em',
            textTransform: 'uppercase',
            lineHeight: 1.1,
            marginBottom: 28,
          }}
        >
          2026 <span style={{ color: C.accent }}>Draft</span>
        </h1>

        {/* Full-width tab switcher */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 0 }}>
          {TABS.map((tab) => {
            const active =
              tab.href === '/gridstream/draft'
                ? pathname === '/gridstream/draft'
                : pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  padding: '14px 20px',
                  textDecoration: 'none',
                  borderRadius: '6px 6px 0 0',
                  background: active ? C.accentGlow : C.surface,
                  border: `1px solid ${active ? C.accent : C.borderDim}`,
                  borderBottom: active ? `1px solid ${C.bgDeep}` : `1px solid ${C.borderDim}`,
                  transition: 'all 0.15s',
                  position: 'relative',
                  // active tab sits flush on the content border
                  marginBottom: active ? -1 : 0,
                }}
              >
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    color: active ? C.accent : C.textMuted,
                    transition: 'color 0.15s',
                  }}
                >
                  {tab.label}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: active ? 'rgba(0,229,255,.65)' : 'rgba(111,154,184,.5)',
                    letterSpacing: '0.01em',
                    transition: 'color 0.15s',
                  }}
                >
                  {tab.desc}
                </span>
                {active && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      height: 2,
                      background: C.accent,
                      borderRadius: '6px 6px 0 0',
                    }}
                  />
                )}
              </Link>
            );
          })}
        </div>

        {/* Separator line that connects to tab content */}
        <div style={{ height: 1, background: C.borderDim }} />
      </div>

      {/* Tab content */}
      <div
        style={{
          maxWidth: 1400,
          margin: '0 auto',
          padding: '24px 16px 80px',
          position: 'relative',
        }}
      >
        {children}
      </div>
    </div>
  );
}
