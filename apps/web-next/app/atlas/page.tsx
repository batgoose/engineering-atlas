'use client';

import { useState } from 'react';
import { buildAtlasPageProps } from '@atlas/ui/contracts';
import { layout, buttons, atlas as atlasStyles, typography } from '@atlas/ui/styles';

export default function AtlasPage() {
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const props = buildAtlasPageProps(activeFilter);

  return (
    <div className={layout.page}>
      {/* filter bar */}
      <div className={atlasStyles.filterBar}>
        <div className={layout.container}>
          <div className={`${atlasStyles.filterBarInner} ${atlasStyles.filterGroup}`}>
            <span className={atlasStyles.filterLabel}>Filter:</span>
            {props.filters.map((filter) => (
              <button
                key={filter.id}
                onClick={() => setActiveFilter(filter.id === 'all' ? null : filter.id)}
                className={filter.isActive ? buttons.filterActive : buttons.filterInactive}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 3D visualization container */}
      <div className={atlasStyles.canvasContainer} style={{ height: 'calc(100vh - 8rem)' }}>
        <div className={atlasStyles.placeholder}>
          <div className={atlasStyles.placeholderContent}>
            <div className="text-8xl mb-6">🌐</div>
            <h1 className={`${typography.h2} mb-4`}>{props.title}</h1>
            <p className={`${typography.bodyMuted} max-w-md`}>{props.description}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
