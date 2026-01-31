/**
 * Card and Container Styles
 *
 * Boxes, cards, panels, and contained elements
 */

export const cards = {
  // base card
  base: 'p-6 bg-atlas-panel border border-slate-800 rounded-lg',
  baseHover:
    'p-6 bg-atlas-panel border border-slate-800 rounded-lg hover:border-slate-700 transition-colors',

  // on dark background
  onDark: 'p-6 bg-atlas-dark border border-slate-800 rounded-lg',
  onDarkHover:
    'p-6 bg-atlas-dark border border-slate-800 rounded-lg hover:border-slate-700 transition-colors',

  // interactive (clickable)
  interactive:
    'p-6 bg-atlas-panel border border-slate-800 rounded-lg hover:border-slate-700 transition-colors cursor-pointer',

  // contact method style
  contactMethod:
    'flex items-center gap-4 p-4 bg-atlas-panel border border-slate-800 rounded-lg hover:border-slate-700 transition-colors',

  // icon container (small box for icons)
  iconBox: 'w-10 h-10 flex items-center justify-center bg-slate-800 rounded-lg',
  iconBoxSmall: 'w-5 h-5 flex items-center justify-center text-xs font-bold bg-slate-700 rounded',
};

export const badges = {
  // status badges
  success: 'text-xs px-2 py-1 rounded bg-emerald-500/20 text-emerald-400',
  warning: 'text-xs px-2 py-1 rounded bg-amber-500/20 text-amber-400',
  neutral: 'text-xs px-2 py-1 rounded bg-slate-500/20 text-slate-400',

  // tech stack tags
  tech: 'text-xs px-2 py-1 bg-slate-800 rounded font-mono',

  // category tags
  tag: 'text-xs px-2 py-1 bg-slate-800 rounded',
};
