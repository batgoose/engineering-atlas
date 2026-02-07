/**
 * Atlas Icon Registry
 *
 * Provides icon lookup for the 3D competency sphere.
 * SVG strings are stored separately in ./icon-strings.ts
 */

import { ICONS, getIconString } from './icon_strings';

// Re-export for convenience
export { ICONS, getIconString };

/**
 * Check if an icon exists for a given competency ID
 */
export function hasIcon(id: string): boolean {
  return id in ICONS;
}

/**
 * Get all available icon IDs
 */
export function getIconIds(): string[] {
  return Object.keys(ICONS);
}

/**
 * Get icons matching a prefix (e.g., 'lang-', 'tool-', 'db-')
 */
export function getIconsByPrefix(prefix: string): string[] {
  return Object.keys(ICONS).filter((id) => id.startsWith(prefix));
}

/**
 * Convert SVG string to a data URL for use in <img src> or CSS background
 * Works in all frameworks without special rendering
 */
export function getIconDataUrl(id: string): string {
  const svg = getIconString(id);
  const encoded = encodeURIComponent(svg).replace(/'/g, '%27').replace(/"/g, '%22');
  return `data:image/svg+xml,${encoded}`;
}

/**
 * Convert SVG string to base64 data URL
 * Use when URL encoding causes issues
 */
export function getIconBase64(id: string): string {
  const svg = getIconString(id);
  // Works in browser and Node with Buffer polyfill
  if (typeof btoa !== 'undefined') {
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  }
  // Node.js fallback
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/**
 * Get icon with custom size applied
 * Returns SVG string with width/height attributes set
 */
export function getIconWithSize(id: string, size: number): string {
  const svg = getIconString(id);
  // Insert width and height after the opening <svg tag
  return svg.replace(/^<svg/, `<svg width="${size}" height="${size}"`);
}

/**
 * Get icon with custom color applied (for single-color icons)
 * Only works with icons using "currentColor" or no fill
 */
export function getIconWithColor(id: string, color: string): string {
  const svg = getIconString(id);
  // Add fill attribute and replace currentColor
  return svg.replace(/currentColor/g, color).replace(/^<svg/, `<svg fill="${color}"`);
}
