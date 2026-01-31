/**
 * Typography Styles
 *
 * Headings, body text, and text utilities
 */

export const typography = {
  // headings
  h1: 'text-4xl md:text-5xl lg:text-6xl font-bold',
  h2: 'text-2xl font-bold',
  h3: 'text-xl font-semibold',
  h4: 'font-semibold',

  // body text
  body: 'text-slate-100',
  bodyLarge: 'text-lg md:text-xl text-slate-400 leading-relaxed',
  bodyMuted: 'text-slate-400',
  bodySmall: 'text-sm text-slate-400',
  bodyXs: 'text-xs text-slate-500',

  // special text
  gradient: 'text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-emerald-400',
  mono: 'font-mono',
  monoSmall: 'font-mono text-sm',
  accent: 'text-cyan-400',

  // labels and captions
  label: 'block text-sm text-slate-400 mb-1',
  caption: 'text-xs text-slate-500',

  // links
  link: 'text-cyan-400 hover:text-cyan-300 transition-colors',
  linkSubtle: 'text-slate-400 hover:text-white transition-colors',
};
