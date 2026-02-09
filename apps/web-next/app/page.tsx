'use client';

import Link from 'next/link';
import { useHighlightedCompetencies, useArtifacts } from '@/app/lib/hooks';
import { buildHomePageProps } from '@atlas/ui/contracts';
import { layout, typography, buttons, cards, badges, hero as heroStyles } from '@atlas/ui/styles';
import { CompetencyIcon } from '@/components/CompetencyIcon';
import type { HeroProps, ApiMethodCardProps } from '@atlas/ui/contracts';
import type { CompetencyNode, Artifact } from '@atlas/types';

export default function HomePage() {
  const props = buildHomePageProps();

  const { data: competencies, isLoading: competenciesLoading } = useHighlightedCompetencies();

  const { data: artifacts, isLoading: artifactsLoading } = useArtifacts();

  const highlightedSkills = competencies ?? [];
  const recentArtifacts = (artifacts ?? []).slice(0, 4);

  return (
    <div className={layout.page}>
      <Hero {...props.hero} />

      <section className={layout.sectionWithBorder}>
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

      <section className={layout.sectionWithBorder}>
        <div className={layout.container}>
          <SectionHeader
            title="Recent Projects"
            link={{ href: '/demos', label: 'View all demos →' }}
          />
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

      <section className={layout.sectionAlt}>
        <div className={layout.container}>
          <h2 className={`${typography.h2} mb-8`}>{props.apiSectionTitle}</h2>
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

// Hero (static content)

function Hero({ greeting, headline, subhead, description, primaryCta, secondaryCta }: HeroProps) {
  return (
    <section className={heroStyles.section}>
      <div className={layout.container}>
        <div className={heroStyles.content}>
          <p className={heroStyles.greeting}>{greeting}</p>
          <h1 className={heroStyles.headline}>
            <span className={heroStyles.headlineGradient}>{headline}</span>
            <br />
            {subhead}
          </h1>
          <p className={heroStyles.description}>{description}</p>
          <div className={heroStyles.ctaContainer}>
            <Link href={primaryCta.href} className={buttons.primary}>
              {primaryCta.label}
            </Link>
            <Link href={secondaryCta.href} className={buttons.secondary}>
              {secondaryCta.label}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function SectionHeader({ title, link }: { title: string; link: { href: string; label: string } }) {
  return (
    <div className={`${layout.flexBetween} mb-8`}>
      <h2 className={typography.h2}>{title}</h2>
      <Link href={link.href} className={`${typography.link} text-sm`}>
        {link.label}
      </Link>
    </div>
  );
}

// Skill Card (from API data)

function SkillCard({ skill }: { skill: CompetencyNode }) {
  return (
    <Link href={`/atlas?skill=${skill.id}`} className={cards.baseHover}>
      <div className="flex items-start gap-4 mb-3">
        <div className="p-2 rounded-lg bg-slate-700/50 flex-shrink-0">
          <CompetencyIcon id={skill.id} size={36} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <h3 className={`${typography.h4} leading-tight`}>{skill.name}</h3>
            <span className={`${badges.tech} text-xs flex-shrink-0`}>{skill.category.name}</span>
          </div>
          <p className={`${typography.bodySmall} line-clamp-2`}>{skill.summary}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {skill.tags.slice(0, 3).map((tag) => (
          <span key={tag} className={`${badges.neutral} text-xs`}>
            {tag}
          </span>
        ))}
      </div>
    </Link>
  );
}

function ProjectCard({ artifact }: { artifact: Artifact }) {
  const statusBadge = {
    complete: badges.success,
    'in-progress': badges.warning,
    planned: badges.neutral,
  }[artifact.status];

  const statusLabel = {
    complete: 'Complete',
    'in-progress': 'In Progress',
    planned: 'Planned',
  }[artifact.status];

  const primaryCompetency = artifact.competencies.find((c) => c.role === 'primary');

  return (
    <Link href={`/demos/${artifact.id}`} className={cards.baseHover}>
      <div className="flex items-start gap-4 mb-3">
        {primaryCompetency && (
          <div className="p-2 rounded-lg bg-slate-700/50 flex-shrink-0">
            <CompetencyIcon id={primaryCompetency.id} size={32} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <h3 className={`${typography.h4} leading-tight`}>{artifact.title}</h3>
            <span className={`${statusBadge} flex-shrink-0`}>{statusLabel}</span>
          </div>
          <p className={`${typography.bodySmall} line-clamp-2`}>{artifact.description}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {artifact.tech_stack.slice(0, 4).map((tech) => (
          <span key={tech} className={badges.tech}>
            {tech}
          </span>
        ))}
      </div>
    </Link>
  );
}

function ApiMethodCard({ title, description, status }: ApiMethodCardProps) {
  const statusBadge = {
    active: badges.success,
    building: badges.warning,
    planned: badges.neutral,
  }[status];

  const statusLabel = {
    active: 'Live',
    building: 'Building',
    planned: 'Planned',
  }[status];

  return (
    <div className={cards.onDark}>
      <div className={`${layout.flexBetween} mb-2`}>
        <h3 className={typography.h4}>{title}</h3>
        <span className={statusBadge}>{statusLabel}</span>
      </div>
      <p className={typography.bodySmall}>{description}</p>
    </div>
  );
}

function SkillsGridSkeleton() {
  return (
    <div className={layout.grid3}>
      {[...Array(6)].map((_, i) => (
        <div key={i} className={`${cards.base} animate-pulse`}>
          <div className="flex items-start gap-4 mb-3">
            <div className="w-14 h-14 bg-slate-700 rounded-lg flex-shrink-0" />
            <div className="flex-1">
              <div className="h-5 bg-slate-700 rounded w-2/3 mb-2" />
              <div className="h-4 bg-slate-700 rounded w-full" />
            </div>
          </div>
          <div className="h-4 bg-slate-700 rounded w-4/5" />
        </div>
      ))}
    </div>
  );
}

function ProjectsGridSkeleton() {
  return (
    <div className={layout.grid2}>
      {[...Array(4)].map((_, i) => (
        <div key={i} className={`${cards.base} animate-pulse`}>
          <div className="flex items-start gap-4 mb-3">
            <div className="w-12 h-12 bg-slate-700 rounded-lg flex-shrink-0" />
            <div className="flex-1">
              <div className="h-5 bg-slate-700 rounded w-2/3 mb-2" />
              <div className="h-4 bg-slate-700 rounded w-full" />
            </div>
          </div>
          <div className="flex gap-2">
            <div className="h-6 bg-slate-700 rounded w-16" />
            <div className="h-6 bg-slate-700 rounded w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className={`${cards.base} text-center py-12`}>
      <p className={typography.bodyMuted}>{message}</p>
    </div>
  );
}
