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
  codeWindow,
  syntax,
} from '@atlas/ui/styles';
import { AtlasIcon } from '@/components/AtlasIcon';
import { useGridStream } from '@/app/lib/useGridStream';

export default function GridStreamDeepDive() {
  const { events, status } = useGridStream();

  return (
    <div className={layout.page}>
      <header className={demosStyles.header}>
        <div className={layout.container}>
          <div className={hero.greeting}>REAL-TIME SUBSYSTEM // GRID_STREAM_02</div>
          <h1 className={`${hero.headline} ${hero.headlineGradient} mt-2`}>
            GridStream WebSocket Hub
          </h1>
          <p className={`${typography.bodyLarge} max-w-3xl mt-4`}>
            Engineering a high-concurrency broadcast engine in Go to distribute live NFL game state
            to thousands of concurrent clients with sub-50ms propagation delay.
          </p>
          <div className="flex gap-3 mt-8">
            <span className={badges.tech}>GOLANG 1.24+</span>
            <span className={badges.tech}>WEBSOCKETS</span>
            <span className={badges.tech}>REDIS PUB/SUB</span>
          </div>
        </div>
      </header>
      // Add this temporary debug section right under your header or in the main grid
      <section className="mt-4 p-4 bg-red-900/20 border border-red-500/50 rounded-lg">
        <h4 className="text-xs font-bold text-red-400 uppercase mb-2">Internal Debug State</h4>
        <div className="grid grid-cols-2 gap-4 text-[10px] font-mono">
          <div>
            <span className="text-slate-500">Connection Status:</span>
            <span className="text-white ml-2">{status}</span>
          </div>
          <div>
            <span className="text-slate-500">Event Count:</span>
            <span className="text-white ml-2">{events.length}</span>
          </div>
        </div>
        {events.length > 0 && (
          <pre className="mt-2 text-[9px] text-amber-200 bg-black/40 p-2 rounded max-h-32 overflow-auto">
            {JSON.stringify(events[0], null, 2)}
          </pre>
        )}
      </section>
      <section className={`${layout.sectionAlt} border-y border-slate-800/50`}>
        <div className={layout.container}>
          <div className="grid lg:grid-cols-3 gap-8">
            <div className="lg:col-span-1">
              <div className={typography.label}>Live Feed Status: {status}</div>
              <h3 className={typography.h3}>Real-Time Ticker</h3>
              <p className={typography.bodySmall}>
                This component is consuming the live Go stream via a framework-agnostic SDK,
                showcasing the polymorphic capabilities of the Atlas architecture.
              </p>
            </div>
            <div className="lg:col-span-2 bg-black/40 p-4 rounded-xl border border-slate-800">
              {events.length === 0 ? (
                <div className="p-8 text-center text-slate-500 font-mono text-xs">
                  AWAITING_KICKOFF_DATA...
                </div>
              ) : (
                <div className="space-y-2">
                  {events.map((ev, i) => (
                    <div
                      key={i}
                      className="flex justify-between items-center p-3 bg-slate-900/80 border-l-2 border-red-500 rounded"
                    >
                      <div>
                        <span className="font-bold text-white mr-2">{ev.team}</span>
                        <span className="text-xs text-slate-400">{ev.message}</span>
                      </div>
                      <span className="font-mono text-amber-400 text-xs">{ev.score}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
      <section className={layout.section}>
        <div className={layout.container}>
          <div className={layout.grid3}>
            <div className={cards.base}>
              <div className={typography.label}>Concurrency Model</div>
              <h3 className={typography.h3}>Hub & Spoke Patterns</h3>
              <p className={typography.bodySmall}>
                Leveraging <strong>Goroutines</strong> and <strong>Channels</strong> to decouple the
                ingestion of game data from the fan-out to thousands of individual WebSocket
                clients.
              </p>
            </div>

            <div className={cards.base}>
              <div className={typography.label}>Latency Control</div>
              <h3 className={typography.h3}>Non-Blocking I/O</h3>
              <p className={typography.bodySmall}>
                Utilizing buffered channels and dedicated write-pumps per client to ensure slow
                consumers do not block the central broadcast hub.
              </p>
            </div>

            <div className={cards.base}>
              <div className={typography.label}>Polymorphic UX</div>
              <h3 className={typography.h3}>Shared Logic SDK</h3>
              <p className={typography.bodySmall}>
                Encapsulating WebSocket lifecycle and reconnection logic in a pure TypeScript SDK (
                <code>@atlas/sdk</code>) for 100% logic reuse across frameworks.
              </p>
            </div>
          </div>
        </div>
      </section>
      <section className={layout.section}>
        <div className={layout.container}>
          <div className="grid lg:grid-cols-2 gap-16 items-start">
            <div className={codeWindow.wrapper}>
              <div className={codeWindow.header}>
                <div className={codeWindow.controls}>
                  <div className={codeWindow.dotRed} />
                  <div className={codeWindow.dotYellow} />
                  <div className={codeWindow.dotGreen} />
                </div>
                <span className={codeWindow.filename}>hub.go</span>
              </div>
              <pre className={codeWindow.content}>
                <code>
                  <span className={syntax.keyword}>func</span> (h *Hub){' '}
                  <span className={syntax.type}>Run</span>() {'{'}
                  {'\n  '} <span className={syntax.keyword}>for</span> {'{'}
                  {'\n    '} <span className={syntax.keyword}>select</span> {'{'}
                  {'\n    '} <span className={syntax.keyword}>case</span> message :={' '}
                  <span className={syntax.keyword}>&lt;-</span>h.broadcast:
                  {'\n      '} <span className={syntax.keyword}>for</span> client :={' '}
                  <span className={syntax.keyword}>range</span> h.clients {'{'}
                  {'\n        '} <span className={syntax.keyword}>select</span> {'{'}
                  {'\n        '} <span className={syntax.keyword}>case</span> client.send{' '}
                  <span className={syntax.keyword}>&lt;-</span>message:
                  {'\n        '} <span className={syntax.keyword}>default</span>:{' '}
                  <span className={syntax.comment}>// Handle slow consumers</span>
                  {'\n          '} <span className={syntax.keyword}>close</span>(client.send)
                  {'\n          '} <span className={syntax.keyword}>delete</span>(h.clients, client)
                  {'\n        '}
                  {'}'}
                  {'\n      '}
                  {'}'}
                  {'\n    '}
                  {'}'}
                  {'\n  '}
                  {'}'}
                  {'\n'}
                  {'}'}
                </code>
              </pre>
            </div>

            <div>
              <h2 className={typography.h2}>The Fan-Out Broadcast Loop</h2>
              <div className="mt-6 space-y-4">
                <p className={typography.body}>
                  The core of GridStream is a select-driven loop that manages the lifecycle of every
                  client connection. By using Go's CSP (Communicating Sequential Processes) model,
                  we avoid mutex locks.
                </p>
                <div className="mt-8 pt-8 border-t border-slate-800">
                  <h4 className={typography.h4}>System Specifications</h4>
                  <dl className="mt-4 grid grid-cols-2 gap-y-4 gap-x-8 text-xs font-mono">
                    <div>
                      <dt className="text-slate-500 uppercase tracking-tighter">Protocol</dt>
                      <dd className="text-red-400">RFC 6455 (WebSocket)</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500 uppercase tracking-tighter">Message Format</dt>
                      <dd className="text-red-400">JSON (Binary-Safe)</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500 uppercase tracking-tighter">Max Connections</dt>
                      <dd className="text-red-400">10k+ / Instance</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500 uppercase tracking-tighter">SDK Footprint</dt>
                      <dd className="text-red-400">&lt; 2KB Gzipped</dd>
                    </div>
                  </dl>
                </div>
              </div>
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
