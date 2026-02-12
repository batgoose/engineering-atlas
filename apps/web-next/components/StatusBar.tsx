'use client';

interface StatusItemProps {
  label: string;
  status: 'ok' | 'warn' | 'error';
}

const dotStyles = {
  ok: 'bg-green-700 shadow-[0_0_6px_rgba(22,163,74,0.7),inset_0_0_2px_rgba(255,255,255,0.3)] animate-[healthPulse_3s_ease-in-out_infinite]',
  warn: 'bg-amber-700 shadow-[0_0_6px_rgba(245,158,11,0.6),inset_0_0_2px_rgba(255,255,255,0.3)] animate-[healthPulse_2s_ease-in-out_infinite]',
  error: 'bg-red-700 shadow-[0_0_6px_rgba(239,68,68,0.6),inset_0_0_2px_rgba(255,255,255,0.3)] animate-[healthPulse_1.5s_ease-in-out_infinite]',
};

function StatusItem({ label, status }: StatusItemProps) {
  return (
    <span className="flex items-center gap-1.5 font-mono text-[9px] font-semibold text-atlas-dark/80 tracking-[0.12em] uppercase">
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotStyles[status]}`} />
      {label}
    </span>
  );
}

export function StatusBar() {
  return (
    <div className="w-full bg-cosmic-metallic shadow-metallic-edge py-1.5 px-6 flex justify-between items-center border-b border-black/20">
      <div className="flex items-center gap-5">
        <StatusItem label="API: 200 OK" status="ok" />
        <StatusItem label="DB: 1.28M Plays" status="ok" />
        <StatusItem label="WebSocket: Connected" status="ok" />
        <StatusItem label="Redis: Active" status="ok" />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-[7px] h-[7px] rounded-full bg-green-700 shadow-[0_0_8px_rgba(22,163,74,0.8),inset_0_0_2px_rgba(255,255,255,0.3)] animate-[healthPulse_2s_ease-in-out_infinite]" />
        <span className="font-mono text-[9px] font-bold text-atlas-dark/90 tracking-[0.2em] uppercase">
          All Systems Nominal
        </span>
      </div>
    </div>
  );
}
