export const cards = {
  base: 'p-6 bg-atlas-panel/90 backdrop-blur-sm border-l-4 border-l-frontend rounded-r-lg rounded-l-sm flex flex-col shadow-2xl relative',
  baseHover: `
    relative p-6 bg-atlas-panel border border-slate-700/50 rounded-md
    transition-all duration-300 flex flex-col overflow-hidden
    hover:border-frontend/40 hover:shadow-[0_0_30px_rgba(217,119,54,0.1)]
    before:absolute before:top-0 before:left-0 before:w-full before:h-[2px]
    before:bg-gradient-to-r before:from-transparent before:via-frontend before:to-transparent
    before:opacity-0 hover:before:opacity-100
  `,

  footer: 'flex items-center justify-between pt-4 mt-auto border-t border-slate-800/60',

  iconBox: 'w-14 h-14 flex items-center justify-center bg-atlas-dark border-2 border-frontend/40 rounded-xl shadow-[inset_0_0_10px_rgba(217,119,54,0.1)]',
  iconBoxSmall: 'w-5 h-5 flex items-center justify-center text-xs font-bold bg-slate-700 rounded',
};

export const card_buttons = {
  secondaryLink:
    'flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors',

  primaryAction:
    'flex items-center gap-2 px-4 py-2 bg-frontend text-atlas-dark rounded-md text-sm font-display font-bold uppercase tracking-tight hover:bg-frontend-light transition-all',

  filterActive:
    'px-3 py-1 text-xs font-medium bg-slate-700 text-white rounded-full transition-colors',
  filterInactive:
    'px-3 py-1 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors',
};

export const badges = {
  success: 'text-[11px] px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold uppercase tracking-wide',
  warning: 'text-[11px] px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-400 font-bold uppercase tracking-wide',
  neutral: 'text-[11px] px-2.5 py-1 rounded-md bg-slate-500/10 border border-slate-500/30 text-slate-400 font-bold uppercase tracking-wide',

  techPrimary: 'text-[10px] px-2.5 py-1 bg-frontend/10 border border-frontend/30 rounded-md font-mono font-semibold text-frontend-light shadow-[0_0_12px_rgba(217,119,54,0.15)]',
  tech: 'text-[10px] px-2 py-0.5 bg-slate-800/60 border border-slate-700/60 rounded font-mono text-slate-400',
};
