// packages/sdk/src/__tests__/config.test.ts
import { describe, it, expect } from 'vitest';
import { siteConfig, frameworks, type FrameworkId } from '../site/site';

describe('siteConfig', () => {
  it('has required top-level properties', () => {
    expect(siteConfig.name).toBe('Engineering Atlas');
    expect(siteConfig.title).toBe('Jason Booth | Engineering Atlas');
    expect(siteConfig.url).toBe('https://jasonbooth.dev');
  });

  it('has a valid description', () => {
    expect(siteConfig.description).toBeDefined();
    expect(siteConfig.description.length).toBeGreaterThan(20);
    expect(siteConfig.description).toContain('software engineering');
  });

  it('has complete author information', () => {
    expect(siteConfig.author.name).toBe('Jason Booth');
    expect(siteConfig.author.email).toContain('@');
    expect(siteConfig.author.github).toContain('github.com');
    expect(siteConfig.author.linkedin).toContain('linkedin.com');
  });

  it('has navigation items', () => {
    expect(siteConfig.navigation).toBeDefined();
    expect(Array.isArray(siteConfig.navigation)).toBe(true);
    expect(siteConfig.navigation.length).toBeGreaterThan(3);
  });

  it('navigation items have required properties', () => {
    siteConfig.navigation.forEach(item => {
      expect(item.label).toBeDefined();
      expect(item.href).toBeDefined();
      expect(item.href).toMatch(/^\//); // Should start with /
    });
  });

  it('includes key navigation pages', () => {
    const navLabels = siteConfig.navigation.map(item => item.label);
    expect(navLabels).toContain('Home');
    expect(navLabels).toContain('Atlas');
    expect(navLabels).toContain('Demos');
    expect(navLabels).toContain('About');
    expect(navLabels).toContain('Contact');
  });
});

describe('frameworks', () => {
  it('exports an array of framework options', () => {
    expect(Array.isArray(frameworks)).toBe(true);
    expect(frameworks.length).toBe(4);
  });

  it('includes all expected frameworks', () => {
    const frameworkIds = frameworks.map(f => f.id);
    expect(frameworkIds).toContain('next');
    expect(frameworkIds).toContain('angular');
    expect(frameworkIds).toContain('vue');
    expect(frameworkIds).toContain('svelte');
  });

  it('has Next.js as the active framework', () => {
    const activeFrameworks = frameworks.filter(f => f.active);
    expect(activeFrameworks.length).toBe(1);
    expect(activeFrameworks[0].id).toBe('next');
  });

  it('each framework has required properties', () => {
    frameworks.forEach(framework => {
      expect(framework.id).toBeDefined();
      expect(framework.name).toBeDefined();
      expect(framework.path).toBeDefined();
      expect(typeof framework.active).toBe('boolean');
    });
  });

  it('framework paths are valid', () => {
    frameworks.forEach(framework => {
      expect(framework.path).toMatch(/^\//); // Should start with /
    });
  });

  it('FrameworkId type includes all framework ids', () => {
    // Type test - this will fail at compile time if types are wrong
    const validIds: FrameworkId[] = ['next', 'angular', 'vue', 'svelte'];
    expect(validIds.length).toBe(4);
  });
});
