/**
 * Page-Specific Styles
 *
 * Styles for specific page sections that don't fit general categories
 */

export const hero = {
  section: 'relative py-24 md:py-32',
  content: 'max-w-3xl',
  greeting: 'text-cyan-400 font-mono text-sm mb-4',
  headline: 'text-4xl md:text-5xl lg:text-6xl font-bold mb-6',
  headlineGradient: 'text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-emerald-400',
  description: 'text-lg md:text-xl text-slate-400 mb-8 leading-relaxed',
  ctaContainer: 'flex flex-wrap gap-4',
};

export const atlas = {
  filterBar: 'border-b border-slate-800 bg-atlas-panel',
  filterBarInner: 'py-4',
  filterLabel: 'text-sm text-slate-400',
  filterGroup: 'flex items-center gap-4',
  canvasContainer: 'relative',
  placeholder: 'absolute inset-0 flex items-center justify-center',
  placeholderContent: 'text-center',
};

export const about = {
  prose: 'prose prose-invert prose-slate max-w-none',
  intro: 'text-xl text-slate-300 mb-8',
  sectionSpacing: 'mb-12',
  timelineEntry: 'flex items-start gap-4',
  timelineYear: 'w-24 flex-shrink-0 text-sm text-slate-500 font-mono',
  highlightItem: 'flex items-start gap-2',
  highlightIcon: 'text-cyan-400',
};

export const contact = {
  methodsContainer: 'space-y-4 mb-12',
  formContainer: 'p-6 bg-atlas-panel border border-slate-800 rounded-lg',
  formFields: 'space-y-4',
  formNote: 'text-xs text-slate-500 mt-4 text-center',
};

export const demos = {
  header: 'py-12 border-b border-slate-800',
  filterSection: 'py-6 border-b border-slate-800 bg-atlas-panel',
  filterRow: 'flex flex-wrap items-center gap-6',
  filterGroup: 'flex items-center gap-2',
  projectGrid: 'py-12',
};
