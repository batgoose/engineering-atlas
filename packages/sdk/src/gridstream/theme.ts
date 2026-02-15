/**
 * Gridstream HUD theme tokens.
 *
 * Framework-agnostic color palette, font declarations, and opacity presets.
 * These map directly to the `C` object from the prototype but are
 * structured for reuse across React, Vue, Svelte, etc.
 */

export const gridstreamColors = {
  // Background tiers
  bg: '#070b14',
  bgPanel: 'rgba(7,11,20,.94)',
  bgPanelHover: 'rgba(7,11,20,.98)',

  // Cyan HUD accent (primary)
  cyan: '#00e5ff',
  cyanDim: '#5a7a90',
  cyanGlow: 'rgba(0,229,255,0.15)',
  cyanBorder: 'rgba(0,229,255,.12)',

  // Amber (scores, highlights)
  amber: '#ffb612',
  amberGlow: 'rgba(255,182,18,0.2)',

  // Signal colors
  green: '#00e676',
  red: '#ff3b4f',

  // Text hierarchy
  textBright: '#e0f0ff',
  text: '#b0c8d8',
  textDim: '#5a7a90',
  textMuted: '#2e4858',

  // Panel borders
  panelBorder: 'rgba(0,229,255,.08)',
  panelBorderHover: 'rgba(0,229,255,.2)',
} as const;

export type GridstreamColor = keyof typeof gridstreamColors;

export const gridstreamFonts = {
  display: "'Orbitron', monospace",
  body: "'Barlow Condensed', sans-serif",
  mono: "'Share Tech Mono', monospace",
} as const;

export const gridstreamFontWeights = {
  normal: 400,
  semibold: 600,
  bold: 700,
  extrabold: 800,
} as const;

/**
 * Google Fonts import URL for all Gridstream typefaces.
 * Include this in the document head or a CSS import.
 */
export const GRIDSTREAM_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;600;700;800;900&family=Barlow+Condensed:wght@400;500;600;700&family=Share+Tech+Mono&display=swap';
