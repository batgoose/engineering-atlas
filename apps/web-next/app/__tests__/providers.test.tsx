import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Providers } from '../providers';

const mockUsePathname = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}));

vi.mock('@tanstack/react-query-devtools', () => ({
  ReactQueryDevtools: () => <div data-testid="react-query-devtools" />,
}));

describe('Providers', () => {
  it('hides query devtools on gridstream routes', () => {
    mockUsePathname.mockReturnValue('/gridstream/teams/WAS');

    render(
      <Providers>
        <div>gridstream</div>
      </Providers>
    );

    expect(screen.queryByTestId('react-query-devtools')).not.toBeInTheDocument();
  });

  it('shows query devtools on non-gridstream routes', () => {
    mockUsePathname.mockReturnValue('/atlas');

    render(
      <Providers>
        <div>atlas</div>
      </Providers>
    );

    expect(screen.getByTestId('react-query-devtools')).toBeInTheDocument();
  });
});
