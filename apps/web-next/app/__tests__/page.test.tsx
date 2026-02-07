// apps/web-next/app/__tests__/page.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import HomePage from '../page';

// Mock Next.js navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    pathname: '/',
  }),
  usePathname: () => '/',
}));

// Mock ALL hooks from your hooks file
vi.mock('@/lib/hooks', () => ({
  useCompetencies: () => ({
    data: [],
    isLoading: false,
    error: null,
  }),
  useArtifacts: () => ({
    data: [],
    isLoading: false,
    error: null,
  }),
  useHighlightedCompetencies: () => ({  // ADD THIS
    data: [],
    isLoading: false,
    error: null,
  }),
  // Add any other hooks your page uses
}));

describe('HomePage', () => {
  it('renders without crashing', () => {
    const { container } = render(<HomePage />);
    expect(container).toBeTruthy();
  });
});
