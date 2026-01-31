'use client';

import { useState } from 'react';
import Link from 'next/link';
import { buildDemosPageProps } from '@atlas/ui/contracts';
import { layout, typography, buttons, cards, badges, demos as demosStyles } from '@atlas/ui/styles';
import type { ProjectCardProps } from '@atlas/ui/contracts';

export default function DemosPage() {
  const [statusFilter, setStatusFilter] = useState('all');
  const [complexityFilter, setComplexityFilter] = useState('all');
  const props = buildDemosPageProps(statusFilter, complexityFilter);

  return (
    <div className={layout.page}>
      {/* header */}
      <section className={demosStyles.header}>
        <div className={layout.container}>
          <h1 className={`${typography.h1} mb-4`}>{props.title}</h1>
          <p className={`${typography.bodyMuted} max-w-2xl`}>{props.description}</p>
        </div>
      </section>

      {/* filters */}
      <section className={demosStyles.filterSection}>
        <div className={layout.container}>
          <div className={demosStyles.filterRow}>
            <div className={demosStyles.filterGroup}>
              <span className={typography.bodySmall}>Status:</span>
              {props.statusFilters.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setStatusFilter(f.id)}
                  className={f.isActive ? buttons.filterActive : buttons.filterInactive}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className={demosStyles.filterGroup}>
              <span className={typography.bodySmall}>Complexity:</span>
              {props.complexityFilters.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setComplexityFilter(f.id)}
                  className={f.isActive ? buttons.filterActive : buttons.filterInactive}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* project grid */}
      <section className={demosStyles.projectGrid}>
        <div className={layout.container}>
          <div className={layout.grid2}>
            {props.projects.map((project) => (
              <ProjectCard key={project.id} {...project} />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function ProjectCard({ title, description, status, techStack, href }: ProjectCardProps) {
  const statusBadge = {
    complete: badges.success,
    'in-progress': badges.warning,
    planned: badges.neutral,
  }[status];

  const statusLabel = {
    complete: 'Complete',
    'in-progress': 'In Progress',
    planned: 'Planned',
  }[status];

  return (
    <Link href={href} className={cards.baseHover}>
      <div className={`${layout.flexBetween} mb-3`}>
        <h3 className={typography.h4}>{title}</h3>
        <span className={statusBadge}>{statusLabel}</span>
      </div>
      <p className={`${typography.bodySmall} mb-4`}>{description}</p>
      <div className={layout.flexGap4}>
        {techStack.map((t) => (
          <span key={t} className={badges.tech}>
            {t}
          </span>
        ))}
      </div>
    </Link>
  );
}
