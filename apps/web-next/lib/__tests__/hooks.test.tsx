// apps/web-next/lib/__tests__/hooks.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { 
  useCompetencies, 
  useArtifacts, 
  useHighlightedCompetencies,
  useCategories,
  queryKeys,
} from '../hooks';

// Mock the API layer
vi.mock('@atlas/api', () => ({
  getCompetencies: vi.fn(() => Promise.resolve([
    { id: 'python', name: 'Python', category: { name: 'Backend' } },
    { id: 'rust', name: 'Rust', category: { name: 'Systems' } },
  ])),
  getArtifacts: vi.fn(() => Promise.resolve([
    { id: 'engineering-atlas', title: 'Engineering Atlas' },
  ])),
  getHighlightedCompetencies: vi.fn(() => Promise.resolve([
    { id: 'python', name: 'Python', category: { name: 'Backend' } },
  ])),
  getCategories: vi.fn(() => Promise.resolve([
    { id: 1, name: 'Backend', display_order: 1 },
    { id: 2, name: 'Frontend', display_order: 2 },
  ])),
  getCategory: vi.fn((id) => Promise.resolve({ id, name: 'Backend', display_order: 1 })),
  getCompetency: vi.fn((id) => Promise.resolve({ id, name: 'Python' })),
  getArtifact: vi.fn((id) => Promise.resolve({ id, title: 'Engineering Atlas' })),
}));

// Create wrapper with QueryClient
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

describe('Query Keys', () => {
  it('generates consistent query keys', () => {
    expect(queryKeys.competencies.all).toEqual(['competencies']);
    expect(queryKeys.competencies.list()).toEqual(['competencies', 'list', undefined]);
    expect(queryKeys.competencies.detail('python')).toEqual(['competencies', 'detail', 'python']);
    expect(queryKeys.artifacts.all).toEqual(['artifacts']);
  });
});

describe('useCompetencies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches competencies successfully', async () => {
    const { result } = renderHook(() => useCompetencies(), {
      wrapper: createWrapper(),
    });

    // Initially loading
    expect(result.current.isLoading).toBe(true);

    // Wait for success
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0].name).toBe('Python');
    expect(result.current.data?.[1].name).toBe('Rust');
  });

  it('accepts filters', async () => {
    const filters = { category: 'Backend' };
    const { result } = renderHook(() => useCompetencies(filters), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toBeDefined();
  });
});

describe('useHighlightedCompetencies', () => {
  it('fetches highlighted competencies', async () => {
    const { result } = renderHook(() => useHighlightedCompetencies(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].name).toBe('Python');
  });
});

describe('useArtifacts', () => {
  it('fetches artifacts successfully', async () => {
    const { result } = renderHook(() => useArtifacts(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].title).toBe('Engineering Atlas');
  });

  it('accepts filters', async () => {
    const filters = { status: 'in-progress' };
    const { result } = renderHook(() => useArtifacts(filters), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toBeDefined();
  });
});

describe('useCategories', () => {
  it('fetches categories successfully', async () => {
    const { result } = renderHook(() => useCategories(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0].name).toBe('Backend');
    expect(result.current.data?.[1].name).toBe('Frontend');
  });
});
