import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import HomePage from '../page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    pathname: '/',
  }),
  usePathname: () => '/',
}));

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
  useHighlightedCompetencies: () => ({
    data: [],
    isLoading: false,
    error: null,
  }),
}));

describe('HomePage', () => {
  it('renders without crashing', () => {
    const { container } = render(<HomePage />);
    expect(container).toBeTruthy();
  });
});
