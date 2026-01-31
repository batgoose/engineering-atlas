/**
 * React Query Hooks
 * 
 * Data fetching hooks for the Next.js app.
 * Wraps @atlas/api with caching, deduplication, and background refresh.
 */

'use client';

import {
  useQuery,
  useSuspenseQuery,
  type UseQueryOptions,
  type UseSuspenseQueryOptions,
} from '@tanstack/react-query';

import {
  getCategories,
  getCategory,
  getCompetencies,
  getCompetency,
  getHighlightedCompetencies,
  getArtifacts,
  getArtifact,
  getAllCompetencies,
  getAllArtifacts,
  type Category,
  type PaginatedResponse,
  type CompetencyFilters,
  type ArtifactFilters,
} from '@atlas/api';

import type { CompetencyNode, Artifact } from '@atlas/types';

// ============================================================
// QUERY KEYS
// ============================================================

export const queryKeys = {
  categories: {
    all: ['categories'] as const,
    detail: (id: number) => ['categories', id] as const,
  },
  competencies: {
    all: ['competencies'] as const,
    list: (filters?: CompetencyFilters) => ['competencies', 'list', filters] as const,
    detail: (id: number | string) => ['competencies', 'detail', id] as const,
    highlighted: ['competencies', 'highlighted'] as const,
  },
  artifacts: {
    all: ['artifacts'] as const,
    list: (filters?: ArtifactFilters) => ['artifacts', 'list', filters] as const,
    detail: (id: number | string) => ['artifacts', 'detail', id] as const,
  },
};

// ============================================================
// CATEGORY HOOKS
// ============================================================

export function useCategories(
  options?: Omit<UseQueryOptions<Category[]>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: queryKeys.categories.all,
    queryFn: getCategories,
    staleTime: 1000 * 60 * 10, // Categories rarely change
    ...options,
  });
}

export function useCategory(
  id: number,
  options?: Omit<UseQueryOptions<Category>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: queryKeys.categories.detail(id),
    queryFn: () => getCategory(id),
    staleTime: 1000 * 60 * 10,
    ...options,
  });
}

// ============================================================
// COMPETENCY HOOKS
// ============================================================

export function useCompetencies(
  filters?: CompetencyFilters,
  options?: Omit<UseQueryOptions<PaginatedResponse<CompetencyNode>>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: queryKeys.competencies.list(filters),
    queryFn: () => getCompetencies(filters),
    staleTime: 1000 * 60 * 5,
    ...options,
  });
}

export function useCompetency(
  id: number | string,
  options?: Omit<UseQueryOptions<CompetencyNode>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: queryKeys.competencies.detail(id),
    queryFn: () => getCompetency(id),
    staleTime: 1000 * 60 * 5,
    ...options,
  });
}

export function useHighlightedCompetencies(
  options?: Omit<UseQueryOptions<PaginatedResponse<CompetencyNode>>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: queryKeys.competencies.highlighted,
    queryFn: getHighlightedCompetencies,
    staleTime: 1000 * 60 * 5,
    ...options,
  });
}

export function useAllCompetencies(
  filters?: CompetencyFilters,
  options?: Omit<UseQueryOptions<CompetencyNode[]>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: [...queryKeys.competencies.all, 'all', filters],
    queryFn: () => getAllCompetencies(filters),
    staleTime: 1000 * 60 * 5,
    ...options,
  });
}

// ============================================================
// ARTIFACT HOOKS
// ============================================================

export function useArtifacts(
  filters?: ArtifactFilters,
  options?: Omit<UseQueryOptions<PaginatedResponse<Artifact>>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: queryKeys.artifacts.list(filters),
    queryFn: () => getArtifacts(filters),
    staleTime: 1000 * 60 * 5,
    ...options,
  });
}

export function useArtifact(
  id: number | string,
  options?: Omit<UseQueryOptions<Artifact>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: queryKeys.artifacts.detail(id),
    queryFn: () => getArtifact(id),
    staleTime: 1000 * 60 * 5,
    ...options,
  });
}

export function useAllArtifacts(
  filters?: ArtifactFilters,
  options?: Omit<UseQueryOptions<Artifact[]>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: [...queryKeys.artifacts.all, 'all', filters],
    queryFn: () => getAllArtifacts(filters),
    staleTime: 1000 * 60 * 5,
    ...options,
  });
}

// ============================================================
// SUSPENSE HOOKS (for Server Components / Suspense boundaries)
// ============================================================

export function useCategoriesSuspense(
  options?: Omit<UseSuspenseQueryOptions<Category[]>, 'queryKey' | 'queryFn'>
) {
  return useSuspenseQuery({
    queryKey: queryKeys.categories.all,
    queryFn: getCategories,
    staleTime: 1000 * 60 * 10,
    ...options,
  });
}

export function useCompetenciesSuspense(
  filters?: CompetencyFilters,
  options?: Omit<UseSuspenseQueryOptions<PaginatedResponse<CompetencyNode>>, 'queryKey' | 'queryFn'>
) {
  return useSuspenseQuery({
    queryKey: queryKeys.competencies.list(filters),
    queryFn: () => getCompetencies(filters),
    staleTime: 1000 * 60 * 5,
    ...options,
  });
}

export function useArtifactsSuspense(
  filters?: ArtifactFilters,
  options?: Omit<UseSuspenseQueryOptions<PaginatedResponse<Artifact>>, 'queryKey' | 'queryFn'>
) {
  return useSuspenseQuery({
    queryKey: queryKeys.artifacts.list(filters),
    queryFn: () => getArtifacts(filters),
    staleTime: 1000 * 60 * 5,
    ...options,
  });
}
