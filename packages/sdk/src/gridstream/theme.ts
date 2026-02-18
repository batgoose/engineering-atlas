/**
 * Gridstream HUD theme tokens.
 * Exact match to the v11 prototype's C object.
 * Framework-agnostic — reuse across React, Vue, Svelte, etc.
 */

export const gridstreamColors = {
  bg: '#070b14',
  panel: '#0a1020',

  cyan: '#00e5ff',
  cyanDim: '#0097a7',
  cyanBorder: 'rgba(0,229,255,0.15)',
  cyanGlow: 'rgba(0,229,255,0.3)',

  amber: '#ffb612',
  amberGlow: 'rgba(255,182,18,0.4)',
  amberBorder: 'rgba(255,182,18,0.25)',

  green: '#00e676',
  red: '#ff3b4f',

  textBright: '#e0f0ff',
  text: '#b0c8d8',
  textDim: '#5a7a90',
  textMuted: '#2e4858',

  panelBorder: 'rgba(0,229,255,0.1)',
} as const;

export type GridstreamColor = keyof typeof gridstreamColors;

export const gridstreamFonts = {
  display: "'Orbitron', monospace",
  body: "'Barlow Condensed', sans-serif",
  mono: "'Share Tech Mono', monospace",
} as const;

export const gridstreamFontWeights = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
} as const;

export const GRIDSTREAM_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Orbitron:wght@400;500;600;700;800;900&family=Barlow+Condensed:ital,wght@0,400;0,500;0,600;0,700;1,600&display=swap';
