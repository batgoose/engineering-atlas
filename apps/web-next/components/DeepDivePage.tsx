// apps/web-next/components/DeepDivePage.tsx
//
// Generic renderer for deep-dive pages. All content comes from
// the SDK's DeepDiveProps — this component is pure layout.

'use client';

import React from 'react';
import Link from 'next/link';
import {
  layout,
  typography,
  badges,
  cards,
  demos as demosStyles,
  codeWindow,
} from '@atlas/ui/styles';
import { AtlasIcon } from '@/components/AtlasIcon';
import type {
  DeepDiveProps,
  DeepDiveCard as CardData,
  SpecItem,
  CodeSnippet,
  DeepDiveFooter as FooterData,
} from '@atlas/sdk/contracts';

interface Props {
  data: DeepDiveProps;
  /** Optional slot for live/interactive content (e.g. GridStream ticker) */
  children?: React.ReactNode;
}

export function DeepDivePage({ data, children }: Props) {
  const { designation, title, subtitle, techBadges, cards: cardData, narrative, footer } = data;

  return (
    <div className={layout.page}>
      {/* Header */}
      <header className={demosStyles.header}>
        <div className={layout.container}>
          <div className="flex items-center gap-3 mb-4">
            <span className="w-8 h-0.5 bg-frontend" />
            <span className={typography.designation}>{designation}</span>
          </div>
          <h1 className={`${typography.h1} text-transparent bg-clip-text bg-cosmic-metallic`}>
            {title}
          </h1>
          <p className={`${typography.bodyLarge} max-w-3xl mt-4`}>{subtitle}</p>
          <div className="flex gap-2 mt-8">
            {techBadges.map((badge) => (
              <span key={badge.label} className={badge.primary ? badges.techPrimary : badges.tech}>
                {badge.label}
              </span>
            ))}
          </div>
        </div>
      </header>

      {/* Optional interactive slot (live tickers, debug panels, etc.) */}
      {children}

      {/* Feature cards */}
      <section className={layout.sectionAlt}>
        <div className={layout.container}>
          <div className={layout.grid3}>
            {cardData.map((card) => (
              <FeatureCard key={card.title} {...card} />
            ))}
          </div>
        </div>
      </section>

      {/* Narrative + Code */}
      <section className={layout.section}>
        <div className={layout.container}>
          <NarrativeSection
            heading={narrative.heading}
            paragraphs={narrative.paragraphs}
            specs={narrative.specs}
            code={narrative.code}
            codePosition={narrative.codePosition}
          />
        </div>
      </section>

      {/* Footer */}
      <PageFooter {...footer} />
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

function FeatureCard({ label, title, description }: CardData) {
  return (
    <div className={cards.base}>
      <div className={typography.label}>{label}</div>
      <h3 className={typography.h3}>{title}</h3>
      <p className={typography.bodySmall}>{description}</p>
    </div>
  );
}

function NarrativeSection({
  heading,
  paragraphs,
  specs,
  code,
  codePosition,
}: {
  heading: string;
  paragraphs: string[];
  specs: SpecItem[];
  code: CodeSnippet;
  codePosition: 'left' | 'right';
}) {
  const proseBlock = (
    <div>
      <h2 className={typography.h2}>{heading}</h2>
      <div className="mt-6 space-y-4">
        {paragraphs.map((p, i) => (
          <p key={i} className={i === 0 ? typography.body : typography.bodyMuted}>
            {p}
          </p>
        ))}
        <SpecTable specs={specs} />
      </div>
    </div>
  );

  const codeBlock = <CodePanel code={code} />;

  return (
    <div className="grid lg:grid-cols-2 gap-16 items-start">
      {codePosition === 'left' ? (
        <>
          {codeBlock}
          {proseBlock}
        </>
      ) : (
        <>
          {proseBlock}
          {codeBlock}
        </>
      )}
    </div>
  );
}

function SpecTable({ specs }: { specs: SpecItem[] }) {
  return (
    <div className="mt-8 pt-8 border-t border-slate-800/50">
      <h4 className={typography.h4}>System Specifications</h4>
      <dl className="mt-4 grid grid-cols-2 gap-y-4 gap-x-8 text-xs font-mono">
        {specs.map((spec) => (
          <div key={spec.label}>
            <dt className="text-slate-500 uppercase tracking-wider">{spec.label}</dt>
            <dd className="text-frontend-light mt-0.5">{spec.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function CodePanel({ code }: { code: CodeSnippet }) {
  return (
    <div className={codeWindow.wrapper}>
      <div className={codeWindow.header}>
        <div className={codeWindow.controls}>
          <div className={codeWindow.dotRed} />
          <div className={codeWindow.dotYellow} />
          <div className={codeWindow.dotGreen} />
        </div>
        <span className={codeWindow.filename}>{code.filename}</span>
      </div>
      <pre className={codeWindow.content}>
        <code>{code.code}</code>
      </pre>
    </div>
  );
}

function PageFooter({ heading, description, repoUrl, backHref, backLabel }: FooterData) {
  return (
    <footer className="border-t border-slate-800/50 bg-atlas-panel/30 mt-12 py-12">
      <div className={layout.container}>
        <div className="flex flex-col md:flex-row justify-between items-center gap-8">
          <div>
            <h3 className={typography.h3}>{heading}</h3>
            <p className={typography.bodySmall}>{description}</p>
          </div>
          <div className="flex gap-4">
            <a
              href={repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-5 py-2.5 bg-atlas-dark border border-slate-700 hover:border-frontend/40 rounded-sm text-white font-display font-bold text-xs uppercase tracking-wide transition-all"
            >
              <AtlasIcon id="tool-github" size={20} className="brightness-0 invert" />
              GitHub Repo
            </a>
            <Link
              href={backHref}
              className="px-6 py-3 bg-cosmic-metallic shadow-metallic-edge text-atlas-darker font-display font-bold text-xs uppercase tracking-wide rounded-sm hover:brightness-110 transition-all"
            >
              {backLabel}
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
