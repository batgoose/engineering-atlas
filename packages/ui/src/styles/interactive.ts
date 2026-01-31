/**
 * Interactive Element Styles
 *
 * Buttons, inputs, and interactive components
 */

export const buttons = {
  // primary actions
  primary:
    'px-6 py-3 bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-semibold rounded-lg transition-colors',
  primarySmall:
    'px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-medium rounded-md transition-colors',

  // secondary actions
  secondary:
    'px-6 py-3 border border-slate-700 hover:border-slate-500 text-slate-300 font-medium rounded-lg transition-colors',
  secondarySmall:
    'px-4 py-2 border border-slate-700 hover:border-slate-500 text-slate-300 font-medium rounded-md transition-colors',

  // ghost/subtle
  ghost:
    'px-4 py-2 text-slate-400 hover:text-white hover:bg-slate-800/50 rounded-md transition-colors',
  ghostActive: 'px-4 py-2 bg-slate-800 text-white rounded-md',

  // icon button
  icon: 'p-2 text-slate-400 hover:text-white transition-colors',

  // filter pills
  filterInactive:
    'px-3 py-1.5 text-sm rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors',
  filterActive:
    'px-3 py-1.5 text-sm rounded-md bg-cyan-500/20 text-cyan-400 border border-cyan-500/50',

  // full width
  fullWidth:
    'w-full px-6 py-3 bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-semibold rounded-lg transition-colors',
};

export const inputs = {
  // text input
  text: 'w-full px-4 py-2 bg-atlas-dark border border-slate-700 rounded-lg focus:border-cyan-500 focus:outline-none transition-colors',

  // textarea
  textarea:
    'w-full px-4 py-2 bg-atlas-dark border border-slate-700 rounded-lg focus:border-cyan-500 focus:outline-none resize-none transition-colors',

  // select
  select:
    'px-3 py-1.5 bg-atlas-dark border border-slate-700 rounded-md text-sm focus:border-cyan-500 focus:outline-none',
};
