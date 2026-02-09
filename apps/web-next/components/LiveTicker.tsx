'use client';
import { useGridStream } from '@/app/lib/useGridStream';

export default function LiveTicker() {
  const { events, status } = useGridStream('ws://go-service.localhost/ws');

  return (
    <div className="p-6 bg-slate-900 text-white rounded-xl shadow-2xl border border-slate-800 w-full max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold tracking-tighter uppercase italic">
          <span className="text-red-600">Grid</span>Stream Live
        </h2>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${status === 'open' ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
          <span className="text-xs font-mono uppercase opacity-50">{status}</span>
        </div>
      </div>

      <div className="space-y-3">
        {events.length === 0 && <p className="text-slate-500 italic">Waiting for kickoff...</p>}
        {events.map((ev, i) => (
          <div key={i} className="flex items-center justify-between p-3 bg-slate-800/50 rounded border-l-4 border-red-600 animate-in fade-in slide-in-from-left-4">
            <div>
              <span className="font-black text-lg">{ev.team}</span>
              <p className="text-sm text-slate-400">{ev.message}</p>
            </div>
            <div className="text-right">
              <span className="font-mono text-amber-400">{ev.score}</span>
              <p className="text-[10px] opacity-30">{ev.timestamp}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}