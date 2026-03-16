'use client';

import Link from 'next/link';
import { cards, typography, badges } from '@atlas/ui/styles';
import { CompetencyIcon } from '@/components/CompetencyIcon';
import type { Artifact } from '@atlas/types';
import { AtlasIcon } from '@/components/AtlasIcon';

const getStatusConfig = (status: Artifact['status']) => {
  const mapping = {
    complete: { style: badges.success, label: 'Complete' },
    'in-progress': { style: badges.warning, label: 'In Progress' },
    planned: { style: badges.neutral, label: 'Planned' },
  };
  return mapping[status];
};

const getDomainDisplay = (domain: Artifact['domain']) => {
  const mapping = {
    football: 'Gridstream',
    infrastructure: 'Infrastructure',
    atlas: 'Atlas',
  };
  return mapping[domain];
};

export function ProjectCard({ artifact }: { artifact: Artifact }) {
  const status = getStatusConfig(artifact.status);
  const primarySkill = artifact.competencies.find((c) => c.role === 'primary');
  const primaryCategory = primarySkill?.category_name;

  return (
    <article className={cards.baseHover}>
      {/* Header: Larger icon + title + status */}
      <div className="flex items-start gap-5 mb-5">
        {primarySkill && (
          <div className="w-16 h-16 flex items-center justify-center rounded-xl bg-slate-900/80 border border-slate-800 flex-shrink-0">
            <CompetencyIcon id={primarySkill.id} size={40} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3 mb-2">
            <h3 className="text-xl font-bold text-slate-50 tracking-tight leading-tight group-hover:text-cyan-400 transition-colors">
              {artifact.title}
            </h3>
            <span className={status.style}>{status.label}</span>
          </div>

          <div className="flex items-center gap-2.5">
            {artifact.domain !== 'atlas' && (
              <>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 font-bold uppercase tracking-wider">
                  {getDomainDisplay(artifact.domain)}
                </span>
                <span className="text-slate-700">→</span>
              </>
            )}
            <span className="text-xs font-bold tracking-wider text-cyan-400 uppercase">
              {primaryCategory || 'SYSTEMS'}
            </span>
            <span className="text-slate-700">·</span>
            <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">
              {artifact.demo_type.replace('-', '_')}
            </span>
          </div>
        </div>
      </div>

      <div className="mb-6">
        <p className={`${typography.bodySmall} text-slate-400 leading-relaxed`}>
          {artifact.description}
        </p>
      </div>

      <div className="mb-6 pb-6 border-b border-slate-800/60">
        <div className="flex flex-wrap items-center gap-2">
          {artifact.tech_stack.slice(0, 2).map((tech) => (
            <span key={tech} className={badges.techPrimary}>
              <span className="mr-1.5 opacity-70">⚡</span>
              {tech}
            </span>
          ))}

          {artifact.tech_stack.length > 2 && <span className="text-slate-700 mx-1">|</span>}

          {artifact.tech_stack.slice(2).map((tech) => (
            <span key={tech} className={badges.tech}>
              {tech}
            </span>
          ))}
        </div>
      </div>

      <footer className="flex items-center justify-between gap-4 mt-auto">
        {artifact.repo_url ? (
          <a
            href={artifact.repo_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors"
          >
            <AtlasIcon id="tool-github" size={16} className="brightness-0 invert" />
            <span>View Source</span>
          </a>
        ) : (
          <div />
        )}

        <Link
          href={`/demos/${artifact.id}`}
          className="flex items-center gap-2 px-4 py-2 bg-cyan-500/10 border border-cyan-500/30 rounded-lg text-sm font-bold text-cyan-400 hover:bg-cyan-500/20 hover:border-cyan-500/50 transition-all group/cta"
        >
          <span>Technical Deep-Dive</span>
          <svg
            className="w-4 h-4 transition-transform group-hover/cta:translate-x-1"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 7l5 5m0 0l-5 5m5-5H6"
            />
          </svg>
        </Link>
      </footer>
    </article>
  );
}
