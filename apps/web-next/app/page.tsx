'use client';

import Link from 'next/link';
import { useHighlightedCompetencies, useArtifacts } from '@/app/lib/hooks';
import { buildHomePageProps } from '@atlas/sdk/contracts';
import { layout, typography } from '@atlas/ui/styles';
import { CompetencyIcon } from '@/components/CompetencyIcon';
import { StatusBar } from '@/components/StatusBar';
import type { HeroProps, ApiMethodCardProps } from '@atlas/sdk/contracts';
import type { CompetencyNode, Artifact } from '@atlas/types';

export default function HomePage() {
  const props = buildHomePageProps();
  const { data: competencies, isLoading: competenciesLoading } = useHighlightedCompetencies();
  const { data: artifacts, isLoading: artifactsLoading } = useArtifacts();

  const highlightedSkills = competencies ?? [];
  const recentArtifacts = (artifacts ?? []).slice(0, 4);

  return (
    <div className={layout.page}>
      <StatusBar />

      <Hero {...props.hero} />

      <section className="py-16 border-t border-white/5">
        <div className={layout.container}>
          <SectionHeader title={props.skillsSectionTitle} link={props.skillsSectionLink} />
          {competenciesLoading ? (
            <SkillsGridSkeleton />
          ) : highlightedSkills.length > 0 ? (
            <div className={layout.grid3}>
              {highlightedSkills.slice(0, 6).map((skill) => (
                <SkillCard key={skill.id} skill={skill} />
              ))}
            </div>
          ) : (
            <EmptyState message="No highlighted skills yet." />
          )}
        </div>
      </section>

      <section className="py-16 border-t border-white/5 relative">
        <div className="absolute top-0 right-0 w-16 h-16 border-t border-r border-frontend/20 pointer-events-none" />
        <div className={layout.container}>
          <SectionHeader title="Recent Projects" link={{ href: '/demos', label: 'View All →' }} />
          {artifactsLoading ? (
            <ProjectsGridSkeleton />
          ) : recentArtifacts.length > 0 ? (
            <div className={layout.grid2}>
              {recentArtifacts.map((artifact) => (
                <ProjectCard key={artifact.id} artifact={artifact} />
              ))}
            </div>
          ) : (
            <EmptyState message="No projects yet." />
          )}
        </div>
      </section>

      <section className="py-16 border-t border-white/5 bg-atlas-panel/30 backdrop-blur-md">
        <div className={layout.container}>
          <h2 className={`${typography.h2} mb-8 text-frontend`}>{props.apiSectionTitle}</h2>
          <div className={layout.grid4}>
            {props.apiMethods.map((method) => (
              <ApiMethodCard key={method.title} {...method} />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function Hero({ greeting, headline, subhead, description, primaryCta, secondaryCta }: HeroProps) {
  return (
    <section className="relative py-24 md:py-32 overflow-hidden">
      {/* subtle radial glow */}
      <div className="absolute top-1/2 left-[30%] -translate-x-1/2 -translate-y-1/2 w-[800px] h-[600px] bg-frontend/5 blur-[120px] rounded-full pointer-events-none" />

      {/* corner registration marks */}
      <div className="absolute top-10 right-10 w-12 h-12 border-t border-r border-frontend/15 pointer-events-none" />
      <div className="absolute bottom-10 left-10 w-12 h-12 border-b border-l border-frontend/10 pointer-events-none" />

      {/* coordinate text */}
      <span className="absolute left-2 top-1/2 -translate-y-1/2 font-mono text-[9px] text-slate-600/20 tracking-[0.15em] [writing-mode:vertical-rl] pointer-events-none">
        36.8529° N · 75.9780° W
      </span>

      <div className={layout.container}>
        <div className="grid lg:grid-cols-[1fr_380px] gap-16 items-start">
          {/* left column */}
          <div className="relative">
            {/* top-left bracket */}
            <div className="absolute -top-5 -left-5 w-10 h-10 border-t-2 border-l-2 border-frontend opacity-40 pointer-events-none" />

            {/* designation line */}
            <div className="flex items-center gap-3 mb-6">
              <span className="w-10 h-0.5 bg-frontend" />
              <span className={typography.designation}>{greeting}</span>
            </div>

            <h1 className="font-display text-5xl md:text-7xl font-bold mb-2 tracking-tight uppercase leading-[0.92] text-white">
              {headline}
            </h1>
            <div className="font-display text-5xl md:text-7xl font-bold italic tracking-tight uppercase leading-[0.92] mb-8 text-transparent bg-clip-text bg-cosmic-metallic">
              {subhead}
            </div>

            <p className="font-body text-lg text-slate-400 mb-10 leading-relaxed max-w-xl">
              {description}
            </p>

            <div className="flex flex-wrap gap-4">
              <Link
                href={primaryCta.href}
                className="inline-flex items-center gap-2.5 px-7 py-3.5 bg-cosmic-metallic shadow-metallic-edge text-atlas-darker font-display font-bold text-[13px] uppercase tracking-wide hover:brightness-110 transition-all hover:-translate-y-0.5 rounded-[3px]"
              >
                {primaryCta.label}
                <svg
                  className="w-3.5 h-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </Link>
              <Link
                href={secondaryCta.href}
                className="inline-flex items-center px-7 py-3.5 border-2 border-frontend/30 text-frontend font-display font-semibold text-[13px] uppercase tracking-wide hover:bg-frontend/5 transition-all hover:-translate-y-0.5 rounded-[3px]"
              >
                {secondaryCta.label}
              </Link>
            </div>
          </div>

          {/* right telemetry panel */}
          <TelemetryPanel />
        </div>
      </div>
    </section>
  );
}

function TelemetryPanel() {
  return (
    <div className="border border-white/6 rounded bg-atlas-darker/60 backdrop-blur-xl overflow-hidden mt-5 hidden lg:block">
      {/* header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/6 bg-white/2">
        <span className="font-mono text-[9px] font-bold text-slate-500 tracking-[0.2em] uppercase">
          System Telemetry
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[9px] text-emerald-500 tracking-wider">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)] animate-[healthPulse_2s_ease-in-out_infinite]" />
          Live
        </span>
      </div>

      {/* portfolio */}
      <TelemetryGroup label="Portfolio">
        <TelemetryRow label="Competencies" value="47 mapped" highlight />
        <TelemetryRow label="Project Demos" value="12 active" highlight />
        <TelemetryRow label="Tech Stack" value="8 languages" />
      </TelemetryGroup>

      {/* redzone */}
      <TelemetryGroup label="Redzone Platform">
        <TelemetryRow label="Historical Plays" value="1,283,491" />
        <TelemetryRow label="NFL Seasons" value="1999–2024" />
        <TelemetryRow label="Django Models" value="22" />
      </TelemetryGroup>

      {/* infrastructure */}
      <TelemetryGroup label="Infrastructure">
        <TelemetryRow label="API Response" value="84ms p50" status="ok" />
        <TelemetryRow label="WebSocket Hub" value="Connected" status="ok" />
        <TelemetryRow label="Cache Hit Rate" value="94.2%" />
        <TelemetryRow label="Uptime" value="99.7%" />
      </TelemetryGroup>

      {/* stack tags */}
      <div className="px-4 py-3 border-t border-white/4 bg-white/1">
        <div className="font-mono text-[8px] font-bold text-slate-600 tracking-[0.2em] uppercase mb-2">
          Active Stack
        </div>
        <div className="flex flex-wrap gap-1">
          {['Django', 'Next.js', 'Go', 'Rust'].map((t) => (
            <span
              key={t}
              className="font-mono text-[9px] px-2 py-0.5 border border-frontend/30 rounded-sm text-frontend-light bg-frontend/5 tracking-wider"
            >
              {t}
            </span>
          ))}
          {['PostgreSQL', 'Redis', 'Docker', 'C++'].map((t) => (
            <span
              key={t}
              className="font-mono text-[9px] px-2 py-0.5 border border-white/6 rounded-sm text-slate-500 bg-white/2 tracking-wider"
            >
              {t}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function TelemetryGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-white/4">
      <div className="px-4 pt-2 pb-1 font-mono text-[8px] font-bold text-slate-600 tracking-[0.2em] uppercase bg-white/1">
        {label}
      </div>
      {children}
    </div>
  );
}

function TelemetryRow({
  label,
  value,
  highlight,
  status,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  status?: 'ok' | 'warn' | 'error';
}) {
  const valueColor =
    status === 'ok' ? 'text-emerald-500' : highlight ? 'text-frontend-light' : 'text-slate-400';

  return (
    <div className="flex items-center justify-between px-4 py-1.5">
      <span className="font-mono text-[10px] text-slate-500 tracking-wider">{label}</span>
      <span className={`flex items-center gap-1.5 font-mono text-[11px] font-medium ${valueColor}`}>
        {status && (
          <span
            className={`w-1 h-1 rounded-full ${status === 'ok' ? 'bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.6)]' : 'bg-red-500'}`}
          />
        )}
        {value}
      </span>
    </div>
  );
}

function SectionHeader({ title, link }: { title: string; link: { href: string; label: string } }) {
  return (
    <div className={`${layout.flexBetween} mb-12`}>
      <h2 className="font-display text-[28px] font-bold text-white uppercase tracking-tight relative pb-3">
        {title}
        <span className="absolute bottom-0 left-0 w-16 h-[3px] bg-gradient-to-r from-frontend to-transparent rounded" />
      </h2>
      <Link
        href={link.href}
        className="font-mono text-[10px] font-semibold text-frontend-light tracking-[0.15em] uppercase opacity-70 hover:opacity-100 transition-opacity"
      >
        {link.label}
      </Link>
    </div>
  );
}

function SkillCard({ skill }: { skill: CompetencyNode }) {
  return (
    <Link
      href={`/atlas?skill=${skill.id}`}
      className="group relative p-6 bg-atlas-panel/40 backdrop-blur-sm border border-white/5 rounded hover:border-frontend/40 transition-all duration-300 overflow-hidden before:absolute before:top-0 before:left-0 before:right-0 before:h-[2px] before:bg-gradient-to-r before:from-transparent before:via-frontend before:to-transparent before:opacity-0 hover:before:opacity-100 hover:shadow-[0_8px_32px_rgba(0,0,0,0.2),0_0_20px_rgba(217,119,54,0.08)]"
    >
      <div className="flex items-start gap-4 mb-4">
        <div className="p-3 rounded-lg bg-atlas-dark border border-white/8 group-hover:border-frontend/40 transition-all">
          <CompetencyIcon id={skill.id} size={32} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-display text-base font-bold text-white uppercase tracking-tight group-hover:text-frontend transition-colors leading-tight">
            {skill.name}
          </h3>
          <span className="font-mono text-[9px] text-frontend/50 tracking-[0.15em] uppercase">
            {skill.category.name}
          </span>
        </div>
      </div>
      <p className="text-slate-500 text-sm leading-relaxed mb-4 line-clamp-2 italic">
        {skill.summary}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {skill.tags.slice(0, 3).map((tag) => (
          <span
            key={tag}
            className="font-mono text-[9px] px-2 py-0.5 border border-white/6 text-slate-600 uppercase tracking-wider"
          >
            {tag}
          </span>
        ))}
      </div>
    </Link>
  );
}

function ProjectCard({ artifact }: { artifact: Artifact }) {
  const primaryCompetency = artifact.competencies.find((c) => c.role === 'primary');
  return (
    <Link
      href={`/demos/${artifact.id}`}
      className="group flex flex-col md:flex-row bg-atlas-panel/40 backdrop-blur-sm border-l-4 border-frontend/80 overflow-hidden hover:bg-atlas-panel/60 transition-all"
    >
      <div className="p-6 flex-1">
        <div className="flex justify-between items-start mb-2">
          <h3 className="font-display text-xl font-bold text-white uppercase tracking-tight group-hover:text-frontend transition-colors">
            {artifact.title}
          </h3>
          <span className="font-mono text-[10px] px-2 py-1 bg-slate-900 text-frontend/70 border border-white/5 uppercase">
            {artifact.status}
          </span>
        </div>
        <p className="text-slate-400 text-sm mb-6 line-clamp-2 italic">{artifact.description}</p>
        <div className="flex flex-wrap gap-1.5">
          {artifact.tech_stack.slice(0, 4).map((tech) => (
            <span
              key={tech}
              className="font-mono text-[10px] font-semibold text-slate-400 uppercase bg-slate-900/50 px-2 py-1 border border-white/5"
            >
              {tech}
            </span>
          ))}
        </div>
      </div>
      <div className="md:w-32 bg-frontend/5 flex items-center justify-center border-l border-white/5 group-hover:bg-cosmic-metallic group-hover:text-white transition-all">
        {primaryCompetency && <CompetencyIcon id={primaryCompetency.id} size={48} />}
      </div>
    </Link>
  );
}

function ApiMethodCard({ title, description, status }: ApiMethodCardProps) {
  return (
    <div className="p-5 bg-atlas-dark border border-white/5 hover:border-frontend/30 transition-colors rounded-sm">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-mono text-xs font-bold text-frontend/80 tracking-widest uppercase">
          {title}
        </h3>
        <div
          className={`w-2 h-2 rounded-full ${status === 'active' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-slate-700'}`}
        />
      </div>
      <p className="text-slate-500 text-xs leading-relaxed">{description}</p>
    </div>
  );
}

function SkillsGridSkeleton() {
  return (
    <div className={layout.grid3}>
      {[...Array(6)].map((_, i) => (
        <div
          key={i}
          className="p-6 bg-atlas-panel/40 border border-white/5 animate-pulse h-48 rounded"
        />
      ))}
    </div>
  );
}

function ProjectsGridSkeleton() {
  return (
    <div className={layout.grid2}>
      {[...Array(4)].map((_, i) => (
        <div key={i} className="h-40 bg-atlas-panel/40 border-l-4 border-white/5 animate-pulse" />
      ))}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-20 border-2 border-dashed border-white/5 rounded-lg">
      <p className="font-mono text-slate-600 text-sm uppercase tracking-widest">{message}</p>
    </div>
  );
}
