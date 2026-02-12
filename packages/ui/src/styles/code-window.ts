export const codeWindow = {
  wrapper:
    'bg-[#0d1117] rounded-xl overflow-hidden border border-slate-800 shadow-2xl flex flex-col',
  header: 'flex items-center justify-between px-4 py-2 bg-slate-900/50 border-b border-slate-800',
  controls: 'flex gap-1.5',
  dotRed: 'w-3 h-3 rounded-full bg-[#ff5f56]',
  dotYellow: 'w-3 h-3 rounded-full bg-[#ffbd2e]',
  dotGreen: 'w-3 h-3 rounded-full bg-[#27c93f]',
  filename: 'text-[10px] font-mono text-slate-500 uppercase tracking-widest',
  content: 'p-6 overflow-x-auto text-sm font-mono leading-relaxed text-slate-300 whitespace-pre',
};

export const syntax = {
  keyword: 'text-magenta-400',
  type: 'text-cyan-400',
  comment: 'text-slate-500 italic',
  attribute: 'text-amber-400',
  string: 'text-emerald-400',
};
