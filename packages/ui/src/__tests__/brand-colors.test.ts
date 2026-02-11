// packages/ui/src/__tests__/brand-colors.test.ts
import { describe, it, expect } from 'vitest';
import { BRAND_COLORS } from '../brand-colors';

describe('BRAND_COLORS', () => {
  it('exports an object of color mappings', () => {
    expect(BRAND_COLORS).toBeDefined();
    expect(typeof BRAND_COLORS).toBe('object');
  });

  it('contains expected framework colors', () => {
    expect(BRAND_COLORS['Next.js']).toBe('#000000');
    expect(BRAND_COLORS['Vue']).toBe('#42b883');
    expect(BRAND_COLORS['Angular']).toBe('#dd0031');
    expect(BRAND_COLORS['Svelte']).toBe('#ff3e00');
  });

  it('contains expected language colors', () => {
    expect(BRAND_COLORS['TypeScript']).toBe('#3178c6');
    expect(BRAND_COLORS['JavaScript']).toBe('#f7df1e');
    expect(BRAND_COLORS['Python']).toBe('#3776ab');
    expect(BRAND_COLORS['Rust']).toBe('#dea584');
    expect(BRAND_COLORS['Go']).toBe('#00add8');
    expect(BRAND_COLORS['C++']).toBe('#00599c');
  });

  it('contains expected tool colors', () => {
    expect(BRAND_COLORS['Docker']).toBe('#2496ed');
    expect(BRAND_COLORS['Kubernetes']).toBe('#326ce5');
    expect(BRAND_COLORS['Git']).toBe('#f05032');
  });

  it('all colors are valid hex codes', () => {
    const hexColorRegex = /^#[0-9a-f]{6}$/i;
    
    Object.entries(BRAND_COLORS).forEach(([_name, color]) => {
      expect(color).toMatch(hexColorRegex);
    });
  });

  it('has at least 10 colors defined', () => {
    const colorCount = Object.keys(BRAND_COLORS).length;
    expect(colorCount).toBeGreaterThanOrEqual(10);
  });

  it('all color names are strings', () => {
    Object.keys(BRAND_COLORS).forEach(name => {
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    });
  });
});
