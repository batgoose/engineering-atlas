
export const cards = {
  
  base: 'p-6 bg-atlas-panel border border-slate-800 rounded-lg flex flex-col',
  baseHover:
    'p-7 bg-atlas-panel border border-slate-800 rounded-lg hover:border-slate-700 hover:shadow-lg hover:shadow-cyan-500/5 transition-all flex flex-col',

  
  footer: 'flex items-center justify-between pt-4 mt-auto border-t border-slate-800/60',

  iconBox: 'w-14 h-14 flex items-center justify-center bg-slate-900 border border-slate-700/50 rounded-xl overflow-hidden relative shadow-inner',
  iconBoxSmall: 'w-5 h-5 flex items-center justify-center text-xs font-bold bg-slate-700 rounded',
};

export const card_buttons = {
  
  secondaryLink:
    'flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors',

  
  primaryAction:
    'flex items-center gap-2 px-4 py-2 bg-cyan-500/10 border border-cyan-500/30 rounded-lg text-sm font-bold text-cyan-400 hover:bg-cyan-500/20 hover:border-cyan-500/50 transition-all',

  filterActive:
    'px-3 py-1 text-xs font-medium bg-slate-700 text-white rounded-full transition-colors',
  filterInactive:
    'px-3 py-1 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors',
};

export const badges = {
  
  success: 'text-[11px] px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold uppercase tracking-wide',
  warning: 'text-[11px] px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-400 font-bold uppercase tracking-wide',
  neutral: 'text-[11px] px-2.5 py-1 rounded-md bg-slate-500/10 border border-slate-500/30 text-slate-400 font-bold uppercase tracking-wide',

  techPrimary: 'text-[10px] px-2.5 py-1 bg-cyan-500/15 border border-cyan-500/40 rounded-md font-mono font-semibold text-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.2)]',
  
  
  tech: 'text-[10px] px-2 py-0.5 bg-slate-800/60 border border-slate-700/60 rounded font-mono text-slate-400',
};
