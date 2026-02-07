'use client';

import React from 'react';
import Link from 'next/link';
import {
  layout,
  typography,
  hero,
  badges,
  cards,
  demos as demosStyles,
  buttons,
  codeWindow,
  syntax,
} from '@atlas/ui/styles';
import { AtlasIcon } from '@/components/AtlasIcon';

export default function NFLIngestorDeepDive() {
  return (
    <div className={layout.page}>
      <header className={demosStyles.header}>
        <div className={layout.container}>
          <div className={hero.greeting}>SYSTEM ARCHITECTURE // DATA_INGESTOR_01</div>
          <h1 className={`${hero.headline} ${hero.headlineGradient} mt-2`}>
            NFL Data Ingestion Pipeline
          </h1>
          <p className={`${typography.bodyLarge} max-w-3xl mt-4`}>
            Architecting a high-throughput archival engine to transform 25+ years of sparse NFLverse
            play-by-play data into a query-optimized relational warehouse.
          </p>
          <div className="flex gap-3 mt-8">
            <span className={badges.tech}>RUST 1.75+</span>
            <span className={badges.tech}>TOKIO ASYNC</span>
            <span className={badges.tech}>POSTGRESQL</span>
          </div>
        </div>
      </header>

      <section className={layout.sectionAlt}>
        <div className={layout.container}>
          <div className={layout.grid3}>
            <div className={cards.base}>
              <div className={typography.label}>Latency Optimization</div>
              <h3 className={typography.h3}>Bulk Ingest Strategy</h3>
              <p className={typography.bodySmall}>
                Leveraging <code>sqlx::QueryBuilder</code> to saturate Postgres write-ahead logs
                with 1,000-record atomic batches, maximizing IOPS and minimizing round-trip
                overhead.
              </p>
            </div>

            <div className={cards.base}>
              <div className={typography.label}>Resource Management</div>
              <h3 className={typography.h3}>Async Backpressure</h3>
              <p className={typography.bodySmall}>
                Utilizing <code>tokio</code> and <code>futures-util</code> to stream multi-gigabit
                datasets with a constant memory footprint, ensuring system stability regardless of
                file size.
              </p>
            </div>

            <div className={cards.base}>
              <div className={typography.label}>State Integrity</div>
              <h3 className={typography.h3}>Idempotent Pipelines</h3>
              <p className={typography.bodySmall}>
                Ensuring data consistency through Upsert logic, allowing for interrupted and resumed
                archive sequences without duplication or record corruption.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className={layout.section}>
        <div className={layout.container}>
          <div className="grid lg:grid-cols-2 gap-16 items-start">
            <div>
              <h2 className={typography.h2}>Type-Safe Nullability Handling</h2>
              <div className="mt-6 space-y-4">
                <p className={typography.body}>
                  The challenge of historical NFL data isn't just missing values—it's the evolution
                  of the league's tracking metrics. Fields like <code>air_yards</code>
                  or <code>epa</code> simply did not exist in the 1999 schema.
                </p>
                <p className={typography.bodyMuted}>
                  By modeling the schema with <code>Option&lt;T&gt;</code> wrappers, the engine
                  treats schema evolution as a compile-time constraint. This eliminates runtime
                  panics and forces explicit handling of sparse historical datasets.
                </p>

                <div className="mt-8 pt-8 border-t border-slate-800">
                  <h4 className={typography.h4}>System Specifications</h4>
                  <dl className="mt-4 grid grid-cols-2 gap-y-4 gap-x-8 text-xs font-mono">
                    <div>
                      <dt className="text-slate-500 uppercase tracking-tighter">Runtime</dt>
                      <dd className="text-cyan-400">Tokio (Multi-threaded)</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500 uppercase tracking-tighter">DB Driver</dt>
                      <dd className="text-cyan-400">SQLx (Async / Compiled)</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500 uppercase tracking-tighter">Performance</dt>
                      <dd className="text-cyan-400">~12k records/sec</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500 uppercase tracking-tighter">Pattern</dt>
                      <dd className="text-cyan-400">ETL / Stream-to-Disk</dd>
                    </div>
                  </dl>
                </div>
              </div>
            </div>

            <div className={codeWindow.wrapper}>
              <div className={codeWindow.header}>
                <div className={codeWindow.controls}>
                  <div className={codeWindow.dotRed} />
                  <div className={codeWindow.dotYellow} />
                  <div className={codeWindow.dotGreen} />
                </div>
                <span className={codeWindow.filename}>models.rs</span>
              </div>

              <pre className={codeWindow.content}>
                <code>
                  <span className={syntax.attribute}>#[derive(Debug, Deserialize, Clone)]</span>
                  {'\n'}
                  <span className={syntax.keyword}>pub struct</span> PlayRecord {'{'}
                  {'\n'}
                  <span className={syntax.keyword}>pub</span> play_id:{' '}
                  <span className={syntax.type}>f64</span>,{'\n'}
                  <span className={syntax.keyword}>pub</span> game_id:{' '}
                  <span className={syntax.type}>String</span>,{'\n'}
                  {'\n'}
                  <span className={syntax.comment}>
                    // Handle schema evolution via Option types
                  </span>
                  {'\n'}
                  <span className={syntax.keyword}>pub</span> epa:{' '}
                  <span className={syntax.type}>Option&lt;f32&gt;</span>,{'\n'}
                  <span className={syntax.keyword}>pub</span> touchdown:{' '}
                  <span className={syntax.type}>Option&lt;f32&gt;</span>,{'\n'}
                  {'}'}
                </code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      <footer className={`${layout.sectionWithBorder} bg-atlas-panel/30 mt-12`}>
        <div className={layout.container}>
          <div className="flex flex-col md:flex-row justify-between items-center gap-8">
            <div>
              <h3 className={typography.h3}>Full Pipeline Source</h3>
              <p className={typography.bodySmall}>
                Explore the batching logic and exhaustive test suites on GitHub.
              </p>
            </div>
            <div className="flex gap-4">
              <a
                href="..."
                target="_blank"
                className="flex items-center gap-3 px-5 py-2.5 bg-slate-800 border border-slate-700 hover:border-slate-500 rounded-lg text-white font-bold text-xs transition-all"
              >
                <AtlasIcon id="tool-github" size={20} />
                GITHUB REPO
              </a>
              <Link
                href="/demos"
                className="px-6 py-3 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-xs rounded-lg shadow-lg shadow-cyan-500/20 transition-all"
              >
                BACK TO DEMOS
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
