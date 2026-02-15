// apps/web-next/app/(site)/demos/gridstream/page.tsx

'use client';

import React from 'react';
import { layout, typography } from '@atlas/ui/styles';
import { DeepDivePage } from '@/components/DeepDivePage';
import { buildGridStreamProps } from '@atlas/sdk/contracts';
import { useGridstreamGame } from '@/app/lib/useGridstreamGame';
import type { MissionLogEntry } from '@atlas/sdk/gridstream/types';

export default function GridStreamDeepDive() {
  const data = buildGridStreamProps();

  return (
    <DeepDivePage data={data}>
      <LiveTicker />
    </DeepDivePage>
  );
}

function LiveTicker() {
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://go-service.localhost/ws';
  const { state, connectionStatus } = useGridstreamGame({ wsUrl });

  const isConnected = connectionStatus === 'open';
  const recentPlays = state.plays.slice(-5).reverse();

  return (
    <section className={`${layout.sectionAlt} border-y border-slate-800/30`}>
      <div className={layout.container}>
        <div className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1">
            <div className="flex items-center gap-2 mb-2">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isConnected
                    ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)] animate-[healthPulse_2s_ease-in-out_infinite]'
                    : 'bg-slate-600'
                }`}
              />
              <span className="font-mono text-[10px] font-bold text-slate-500 uppercase tracking-[0.15em]">
                Live Feed: {connectionStatus}
              </span>
            </div>
            <h3 className={typography.h3}>Real-Time Ticker</h3>
            <p className={`${typography.bodySmall} mt-2`}>
              Connected to the Go WebSocket service via a framework-agnostic SDK.
              Events stream in as typed envelopes — game updates, plays, and scoring
              events rendered in real time.
            </p>
          </div>

          <div className="lg:col-span-2 bg-atlas-darker/60 p-4 rounded-sm border border-slate-800/50">
            {recentPlays.length === 0 ? (
              <div className="p-8 text-center font-mono text-xs text-slate-600 uppercase tracking-wider">
                {isConnected
                  ? 'Listening for game events...'
                  : 'Awaiting connection...'}
              </div>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {recentPlays.map((play) => (
                  <TickerRow key={play.id} play={play} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function TickerRow({ play }: { play: MissionLogEntry }) {
  const borderColor =
    play.type === 'score' ? 'border-emerald-500'
    : play.type === 'turnover' ? 'border-red-500'
    : 'border-frontend';

  return (
    <div
      className={`flex justify-between items-center p-3 bg-atlas-dark/80 border-l-2 ${borderColor} rounded-sm`}
    >
      <div>
        {play.team && (
          <span className="font-display font-bold text-white mr-2">
            {play.team}
          </span>
        )}
        <span className="text-xs text-slate-400">{play.text}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-mono text-slate-600 text-[10px]">
          Q{play.quarter} {play.clock}
        </span>
        {play.epa !== 0 && (
          <span className={`font-mono text-xs ${play.epa > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {play.epa > 0 ? '+' : ''}{play.epa.toFixed(1)}
          </span>
        )}
      </div>
    </div>
  );
}
