'use client';

import { useState } from 'react';
import { useArtifacts } from '@/app/lib/hooks';
import { layout, typography, buttons, cards, badges, demos as demosStyles } from '@atlas/ui/styles';
import type { ArtifactStatus, ArtifactDomain } from '@atlas/types';
import { ProjectCard } from './ProjectCard';

export default function DemosPage() {
  const [statusFilter, setStatusFilter] = useState<ArtifactStatus | 'all'>('all');
  const [domainFilter, setDomainFilter] = useState<ArtifactDomain | 'all'>('all');

  const {
    data: artifacts,
    isLoading,
    error,
  } = useArtifacts({
    status: statusFilter === 'all' ? undefined : statusFilter,
    domain: domainFilter === 'all' ? undefined : domainFilter,
  });

  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const filteredArtifacts = (artifacts ?? []).filter((artifact) => {
    if (statusFilter !== 'all' && artifact.status !== statusFilter) return false;
    if (domainFilter !== 'all' && artifact.domain !== domainFilter) return false;

    if (categoryFilter !== 'all') {
      const primaryCompetency = artifact.competencies.find((c) => c.role === 'primary');
      if (!primaryCompetency || primaryCompetency.category_name.toLowerCase() !== categoryFilter) {
        return false;
      }
    }

    return true;
  });

  return (
    <div className={layout.page}>
      <section className={demosStyles.header}>
        <div className={layout.container}>
          <h1 className={`${typography.h1} text-3xl mb-4`}>Project Demos</h1>
          <p className={`${typography.bodyMuted} max-w-2xl`}>
            Real-world applications demonstrating technical expertise across the stack.
          </p>
        </div>
      </section>

      <section className="py-6 border-b border-slate-800/50">
        <div className={layout.container}>
          <div className="flex flex-wrap gap-6">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Status
              </span>
              <div className="flex gap-1 bg-slate-900/50 rounded-lg p-1 border border-slate-800">
                {(['all', 'complete', 'in-progress', 'planned'] as const).map((status) => (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(status)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                      statusFilter === status
                        ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {status === 'all'
                      ? 'All'
                      : status === 'in-progress'
                        ? 'In Progress'
                        : capitalize(status)}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Project
              </span>
              <div className="flex gap-1 bg-slate-900/50 rounded-lg p-1 border border-slate-800">
                {(['all', 'football', 'infrastructure', 'atlas'] as const).map((project) => (
                  <button
                    key={project}
                    onClick={() => setDomainFilter(project)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                      domainFilter === project
                        ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {project === 'all'
                      ? 'All'
                      : project === 'football'
                        ? 'Redzone'
                        : capitalize(project)}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Category
              </span>
              <div className="flex gap-1 bg-slate-900/50 rounded-lg p-1 border border-slate-800">
                {(['all', 'systems', 'frontend', 'backend', 'devops'] as const).map((category) => (
                  <button
                    key={category}
                    onClick={() => setCategoryFilter(category)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                      categoryFilter === category
                        ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {capitalize(category)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={demosStyles.projectGrid}>
        <div className={layout.container}>
          {isLoading ? (
            <ProjectsGridSkeleton />
          ) : error ? (
            <ErrorState message="Failed to load projects. Is the API running?" />
          ) : filteredArtifacts.length > 0 ? (
            <div className={`${layout.grid2} items-stretch`}>
              {filteredArtifacts.map((artifact) => (
                <ProjectCard key={artifact.id} artifact={artifact} />
              ))}
            </div>
          ) : (
            <EmptyState message="No projects match your filters." />
          )}
        </div>
      </section>
    </div>
  );
}

function ProjectsGridSkeleton() {
  return (
    <div className={layout.grid2}>
      {[...Array(4)].map((_, i) => (
        <div key={i} className={`${cards.base} animate-pulse`}>
          <div className="flex items-start gap-4 mb-4">
            <div className="w-16 h-16 bg-slate-700 rounded-lg flex-shrink-0" />
            <div className="flex-1">
              <div className="h-5 bg-slate-700 rounded w-2/3 mb-2" />
              <div className="h-4 bg-slate-700 rounded w-full mb-1" />
              <div className="h-4 bg-slate-700 rounded w-4/5" />
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mb-4">
            <div className="h-6 bg-slate-700 rounded w-16" />
            <div className="h-6 bg-slate-700 rounded w-20" />
            <div className="h-6 bg-slate-700 rounded w-14" />
          </div>
          <div className="pt-3 border-t border-slate-700/50">
            <div className="h-4 bg-slate-700 rounded w-24" />
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

function ErrorState({ message }: { message: string }) {
  return (
    <div className={`${cards.base} text-center py-12 border-red-500/50`}>
      <p className="text-red-400">{message}</p>
    </div>
  );
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
