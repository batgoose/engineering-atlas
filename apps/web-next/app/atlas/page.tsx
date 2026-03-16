'use client';

import { useState, useCallback, useMemo, Suspense, lazy } from 'react';
import { useCompetencies, useCategories, useArtifacts } from '@/app/lib/hooks';
import { buttons } from '@atlas/ui/styles';
import { CompetencyIcon } from '@/components/CompetencyIcon';
import type { CompetencyNode, Artifact } from '@atlas/types';

const StarMap = lazy(() =>
  import('@/components/StarMap').then((mod) => ({ default: mod.StarMap }))
);

export default function AtlasPage() {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [selectedCompetency, setSelectedCompetency] = useState<CompetencyNode | null>(null);
  const [hoveredCompetency, setHoveredCompetency] = useState<CompetencyNode | null>(null);

  const { data: categories, isLoading: categoriesLoading } = useCategories();
  const { data: competencies, isLoading: competenciesLoading } = useCompetencies();
  const { data: artifacts } = useArtifacts();

  const isLoading = categoriesLoading || competenciesLoading;
  const allSkills = useMemo(() => competencies ?? [], [competencies]);
  const allArtifacts = useMemo(() => artifacts ?? [], [artifacts]);

  const relatedArtifacts = useMemo(() => {
    if (!selectedCompetency) return [];
    return allArtifacts.filter((artifact) =>
      artifact.competencies.some((c) => c.id === selectedCompetency.id)
    );
  }, [selectedCompetency, allArtifacts]);

  const relatedCompetencies = useMemo(() => {
    if (!selectedCompetency) return [];
    return allSkills
      .filter(
        (s) =>
          s.id !== selectedCompetency.id && s.category.name === selectedCompetency.category.name
      )
      .slice(0, 5);
  }, [selectedCompetency, allSkills]);

  const handleCategoryFilter = useCallback((categoryName: string | null) => {
    setActiveCategory(categoryName);
    setSelectedCompetency(null);
  }, []);

  const handleStarClick = useCallback((competency: CompetencyNode) => {
    setSelectedCompetency((prev) => (prev?.id === competency.id ? null : competency));
  }, []);

  const handleStarHover = useCallback((competency: CompetencyNode | null) => {
    setHoveredCompetency(competency);
  }, []);

  const handleRelatedClick = useCallback((competency: CompetencyNode) => {
    setSelectedCompetency(competency);
  }, []);

  return (
    <div className="h-screen flex bg-atlas-darker overflow-hidden">
      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex-shrink-0 border-b border-slate-800/50 bg-atlas-dark/60 backdrop-blur-sm z-10">
          <div className="px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-slate-500 text-sm">Constellation:</span>
              <button
                onClick={() => handleCategoryFilter(null)}
                className={activeCategory === null ? buttons.filterActive : buttons.filterInactive}
              >
                All
              </button>
              {categories?.map((category) => (
                <button
                  key={category.id}
                  onClick={() => handleCategoryFilter(category.name)}
                  className={
                    activeCategory === category.name ? buttons.filterActive : buttons.filterInactive
                  }
                >
                  {category.name}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-4 text-sm">
              <span className="font-mono text-slate-500">
                {isLoading ? '...' : `${allSkills.length} stars`}
              </span>
            </div>
          </div>
        </header>

        <main className="flex-1 relative min-h-0">
          {isLoading ? (
            <LoadingState />
          ) : allSkills.length > 0 ? (
            <Suspense fallback={<LoadingState />}>
              <StarMap
                competencies={allSkills}
                activeCategory={activeCategory}
                selectedId={selectedCompetency?.id ?? null}
                hoveredId={hoveredCompetency?.id ?? null}
                onStarClick={handleStarClick}
                onStarHover={handleStarHover}
              />
            </Suspense>
          ) : (
            <EmptyState />
          )}
        </main>
      </div>

      <aside
        className={`
          flex-shrink-0 w-96 border-l border-slate-800/50 bg-atlas-dark/95 backdrop-blur-md
          transform transition-transform duration-300 ease-out
          ${selectedCompetency ? 'translate-x-0' : 'translate-x-full'}
          overflow-y-auto
        `}
      >
        {selectedCompetency && (
          <CompetencyDetail
            competency={selectedCompetency}
            relatedArtifacts={relatedArtifacts}
            relatedCompetencies={relatedCompetencies}
            onClose={() => setSelectedCompetency(null)}
            onRelatedClick={handleRelatedClick}
          />
        )}
      </aside>
    </div>
  );
}

function CompetencyDetail({
  competency,
  relatedArtifacts,
  relatedCompetencies,
  onClose,
  onRelatedClick,
}: {
  competency: CompetencyNode;
  relatedArtifacts: Artifact[];
  relatedCompetencies: CompetencyNode[];
  onClose: () => void;
  onRelatedClick: (c: CompetencyNode) => void;
}) {
  return (
    <div className="p-6">
      <div className="flex items-start gap-4 mb-6">
        <div className="p-3 rounded-xl bg-atlas-darker border border-slate-700/50">
          <CompetencyIcon id={competency.id} size={48} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h2 className="font-display text-xl font-bold text-white uppercase tracking-tight">
              {competency.name}
            </h2>
            <button
              onClick={onClose}
              className="text-slate-500 hover:text-white text-lg p-1 -mr-1 -mt-1"
            >
              ✕
            </button>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-frontend text-sm font-medium">{competency.category.name}</span>
          </div>
        </div>
      </div>

      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-slate-400 text-sm">Proficiency</span>
          <span className="text-frontend text-sm font-medium">{competency.proficiency}</span>
        </div>
        <ProficiencyBar level={competency.proficiency} />
      </div>

      <div className="mb-6">
        <h3 className="font-display text-slate-300 text-sm font-medium uppercase tracking-wide mb-2">
          Summary
        </h3>
        <p className="text-slate-400 text-sm leading-relaxed">{competency.summary}</p>
      </div>

      {competency.tags.length > 0 && (
        <div className="mb-6">
          <h3 className="font-display text-slate-300 text-sm font-medium uppercase tracking-wide mb-2">
            Tags
          </h3>
          <div className="flex flex-wrap gap-2">
            {competency.tags.map((tag) => (
              <span
                key={tag}
                className="px-2 py-1 text-xs font-mono bg-atlas-darker text-slate-300 rounded border border-slate-700/50"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {relatedArtifacts.length > 0 && (
        <div className="mb-6">
          <h3 className="font-display text-slate-300 text-sm font-medium uppercase tracking-wide mb-3">
            Linked Projects ({relatedArtifacts.length})
          </h3>
          <div className="space-y-2">
            {relatedArtifacts.map((artifact) => (
              <a
                key={artifact.id}
                href={`/demos/${artifact.id}`}
                className="block p-3 rounded-lg bg-atlas-darker border border-slate-700/30 hover:border-frontend/30 transition-colors"
              >
                <div className="font-display font-medium text-white text-sm">{artifact.title}</div>
                <div className="text-slate-500 text-xs mt-1 line-clamp-1">
                  {artifact.description}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {relatedCompetencies.length > 0 && (
        <div className="mb-6">
          <h3 className="font-display text-slate-300 text-sm font-medium uppercase tracking-wide mb-3">
            Related Skills
          </h3>
          <div className="flex flex-wrap gap-2">
            {relatedCompetencies.map((comp) => (
              <button
                key={comp.id}
                onClick={() => onRelatedClick(comp)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-atlas-darker border border-slate-700/30 hover:border-frontend/30 transition-colors"
              >
                <CompetencyIcon id={comp.id} size={16} />
                <span className="text-slate-300 text-sm">{comp.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProficiencyBar({ level }: { level: string }) {
  const levels = ['Learning', 'Familiar', 'Proficient', 'Expert'];
  const index = levels.indexOf(level);
  const percentage = index >= 0 ? ((index + 1) / levels.length) * 100 : 50;

  return (
    <div className="h-2 bg-atlas-darker rounded-full overflow-hidden">
      <div
        className="h-full bg-gradient-to-r from-frontend to-frontend-light rounded-full transition-all duration-500"
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

function LoadingState() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-atlas-darker">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-frontend border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="font-mono text-slate-400 text-sm">Mapping the stars...</p>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-atlas-darker">
      <div className="text-center">
        <div className="text-6xl mb-6">🌌</div>
        <h2 className="font-display text-xl font-bold text-white mb-2">No stars yet</h2>
        <p className="text-slate-400">Add some skills to populate the starmap.</p>
      </div>
    </div>
  );
}
