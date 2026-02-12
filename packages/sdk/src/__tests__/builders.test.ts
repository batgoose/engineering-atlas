// packages/sdk/src/__tests__/builders.test.ts
import { describe, it, expect } from 'vitest';
import { buildNavigation, getFrameworkOptions } from '../contracts/builders';

describe('buildNavigation', () => {
  it('returns navigation with correct structure', () => {
    const result = buildNavigation('/');

    expect(result).toHaveProperty('items');
    expect(result).toHaveProperty('currentPath');
    expect(result).toHaveProperty('logoText');
  });

  it('sets the logo text', () => {
    const result = buildNavigation('/');
    expect(result.logoText).toBe('Atlas');
  });

  it('includes all navigation items', () => {
    const result = buildNavigation('/');

    expect(result.items.length).toBe(5);

    const labels = result.items.map((item) => item.label);
    expect(labels).toContain('Home');
    expect(labels).toContain('Atlas');
    expect(labels).toContain('Demos');
    expect(labels).toContain('About');
    expect(labels).toContain('Contact');
  });

  it('marks the home page as active when on /', () => {
    const result = buildNavigation('/');

    const homeItem = result.items.find((item) => item.label === 'Home');
    const atlasItem = result.items.find((item) => item.label === 'Atlas');

    expect(homeItem?.isActive).toBe(true);
    expect(atlasItem?.isActive).toBe(false);
  });

  it('marks the atlas page as active when on /atlas', () => {
    const result = buildNavigation('/atlas');

    const homeItem = result.items.find((item) => item.label === 'Home');
    const atlasItem = result.items.find((item) => item.label === 'Atlas');

    expect(homeItem?.isActive).toBe(false);
    expect(atlasItem?.isActive).toBe(true);
  });

  it('marks the demos page as active when on /demos', () => {
    const result = buildNavigation('/demos');

    const demosItem = result.items.find((item) => item.label === 'Demos');
    expect(demosItem?.isActive).toBe(true);
  });

  it('sets currentPath to the provided path', () => {
    const result = buildNavigation('/about');
    expect(result.currentPath).toBe('/about');
  });

  it('all nav items have required properties', () => {
    const result = buildNavigation('/');

    result.items.forEach((item) => {
      expect(item).toHaveProperty('label');
      expect(item).toHaveProperty('href');
      expect(item).toHaveProperty('isActive');
      expect(typeof item.isActive).toBe('boolean');
    });
  });
});

describe('getFrameworkOptions', () => {
  it('returns an array of framework options', () => {
    const options = getFrameworkOptions();

    expect(Array.isArray(options)).toBe(true);
    expect(options.length).toBe(4);
  });

  it('includes all expected frameworks', () => {
    const options = getFrameworkOptions();
    const names = options.map((opt) => opt.name);

    expect(names).toContain('Next.js');
    expect(names).toContain('Angular');
    expect(names).toContain('Vue');
    expect(names).toContain('Svelte');
  });

  it('has Next.js as the only active framework', () => {
    const options = getFrameworkOptions();
    const activeOptions = options.filter((opt) => opt.active);

    expect(activeOptions.length).toBe(1);
    expect(activeOptions[0].name).toBe('Next.js');
  });

  it('each framework has an icon', () => {
    const options = getFrameworkOptions();

    options.forEach((opt) => {
      expect(opt.icon).toBeDefined();
      expect(opt.icon.length).toBeGreaterThan(0);
    });
  });

  it('each framework has required properties', () => {
    const options = getFrameworkOptions();

    options.forEach((opt) => {
      expect(opt).toHaveProperty('id');
      expect(opt).toHaveProperty('name');
      expect(opt).toHaveProperty('icon');
      expect(opt).toHaveProperty('path');
      expect(opt).toHaveProperty('active');
      expect(typeof opt.active).toBe('boolean');
    });
  });

  it('framework ids are unique', () => {
    const options = getFrameworkOptions();
    const ids = options.map((opt) => opt.id);
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(ids.length);
  });

  it('framework paths start with /', () => {
    const options = getFrameworkOptions();

    options.forEach((opt) => {
      expect(opt.path).toMatch(/^\//);
    });
  });
});
