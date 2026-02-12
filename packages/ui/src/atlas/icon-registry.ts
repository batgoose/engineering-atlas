import { ICONS, getIconString } from './icon_strings';

export { ICONS, getIconString };

export function hasIcon(id: string): boolean {
  return id in ICONS;
}

export function getIconIds(): string[] {
  return Object.keys(ICONS);
}

export function getIconsByPrefix(prefix: string): string[] {
  return Object.keys(ICONS).filter((id) => id.startsWith(prefix));
}

export function getIconDataUrl(id: string): string {
  const svg = getIconString(id);
  const encoded = encodeURIComponent(svg).replace(/'/g, '%27').replace(/"/g, '%22');
  return `data:image/svg+xml,${encoded}`;
}

export function getIconBase64(id: string): string {
  const svg = getIconString(id);
  if (typeof btoa !== 'undefined') {
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  }
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

export function getIconWithSize(id: string, size: number): string {
  const svg = getIconString(id);
  return svg.replace(/^<svg/, `<svg width="${size}" height="${size}"`);
}

export function getIconWithColor(id: string, color: string): string {
  const svg = getIconString(id);
  return svg.replace(/currentColor/g, color).replace(/^<svg/, `<svg fill="${color}"`);
}
