// apps/web-next/components/__tests__/constellations.test.ts
import { describe, it, expect } from 'vitest';
import * as constellations from '@atlas/sdk/atlas';

describe('Constellations', () => {
  it('exports constellation data', () => {
    // Just verify the module can be imported
    expect(constellations).toBeDefined();
  });

  // Add more specific tests once you know what functions/data your module exports
  // Example:
  // it('has constellation data', () => {
  //   expect(constellations.CONSTELLATIONS).toBeDefined();
  // });
});
