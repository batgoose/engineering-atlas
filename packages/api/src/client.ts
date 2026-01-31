/**
 * Atlas API Client
 * 
 * Framework-agnostic typed fetch wrapper for the Django REST API.
 * Used by React Query hooks, Vue composables, Angular services, etc.
 */

import type {
  CompetencyNode,
  Artifact,
  Proficiency,
  CompetencyType,
  ArtifactStatus,
  ArtifactComplexity,
  DemoType,
} from '@atlas/types';

// ============================================================
// CONFIGURATION
// ============================================================

export interface ApiConfig {
  baseUrl: string;
  timeout?: number;
}

let config: ApiConfig = {
  baseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api',
  timeout: 10000,
};

export function configureApi(newConfig: Partial<ApiConfig>) {
  config = { ...config, ...newConfig };
}

export function getApiConfig(): ApiConfig {
  return config;
}

// ============================================================
// ERROR HANDLING
// ============================================================

export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public url: string,
    public data?: unknown
  ) {
    super(`API Error ${status}: ${statusText} (${url})`);
    this.name = 'ApiError';
  }
}

// ============================================================
// RESPONSE TYPES
// ============================================================

// DRF pagination wrapper (when pagination is enabled)
export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

// Category doesn't have pagination (pagination_class = None)
export interface Category {
  id: number;
  name: string;
  description: string;
  display_order: number;
}

// ============================================================
// FILTER TYPES
// ============================================================

export interface CompetencyFilters {
  category?: number;
  competency_type?: CompetencyType;
  proficiency?: Proficiency;
  portfolio_highlight?: boolean;
  search?: string;
}

export interface ArtifactFilters {
  status?: ArtifactStatus;
  complexity?: ArtifactComplexity;
  demo_type?: DemoType;
  tech_stack?: string;
  search?: string;
}

// ============================================================
// CORE FETCH WRAPPER
// ============================================================

async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${config.baseUrl}${endpoint}`;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let data: unknown;
      try {
        data = await response.json();
      } catch {
        // Response body wasn't JSON
      }
      throw new ApiError(response.status, response.statusText, url, data);
    }

    return response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error instanceof ApiError) {
      throw error;
    }
    
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError(408, 'Request Timeout', url);
    }
    
    throw error;
  }
}

// ============================================================
// QUERY STRING BUILDER
// ============================================================

function buildQueryString(params: Record<string, unknown>): string {
  const searchParams = new URLSearchParams();
  
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.append(key, String(value));
    }
  });
  
  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

// ============================================================
// CATEGORY ENDPOINTS
// ============================================================

export async function getCategories(): Promise<Category[]> {
  // No pagination, returns array directly
  return apiFetch<Category[]>('/categories/');
}

export async function getCategory(id: number): Promise<Category> {
  return apiFetch<Category>(`/categories/${id}/`);
}

// ============================================================
// COMPETENCY ENDPOINTS
// ============================================================

export async function getCompetencies(
  filters?: CompetencyFilters
): Promise<PaginatedResponse<CompetencyNode>> {
  const query = filters ? buildQueryString(filters) : '';
  return apiFetch<PaginatedResponse<CompetencyNode>>(`/competencies/${query}`);
}

export async function getCompetency(id: number | string): Promise<CompetencyNode> {
  return apiFetch<CompetencyNode>(`/competencies/${id}/`);
}

export async function getCompetenciesByCategory(
  categoryId: number
): Promise<PaginatedResponse<CompetencyNode>> {
  return getCompetencies({ category: categoryId });
}

export async function getHighlightedCompetencies(): Promise<PaginatedResponse<CompetencyNode>> {
  return getCompetencies({ portfolio_highlight: true });
}

export async function searchCompetencies(
  query: string
): Promise<PaginatedResponse<CompetencyNode>> {
  return getCompetencies({ search: query });
}

// ============================================================
// ARTIFACT ENDPOINTS
// ============================================================

export async function getArtifacts(
  filters?: ArtifactFilters
): Promise<PaginatedResponse<Artifact>> {
  const query = filters ? buildQueryString(filters) : '';
  return apiFetch<PaginatedResponse<Artifact>>(`/artifacts/${query}`);
}

export async function getArtifact(id: number | string): Promise<Artifact> {
  return apiFetch<Artifact>(`/artifacts/${id}/`);
}

export async function getArtifactsByStatus(
  status: ArtifactStatus
): Promise<PaginatedResponse<Artifact>> {
  return getArtifacts({ status });
}

export async function getArtifactsByTech(
  tech: string
): Promise<PaginatedResponse<Artifact>> {
  return getArtifacts({ tech_stack: tech });
}

export async function searchArtifacts(
  query: string
): Promise<PaginatedResponse<Artifact>> {
  return getArtifacts({ search: query });
}

// ============================================================
// CONVENIENCE: FETCH ALL (handles pagination)
// ============================================================

export async function getAllCompetencies(
  filters?: CompetencyFilters
): Promise<CompetencyNode[]> {
  const results: CompetencyNode[] = [];
  let url: string | null = `/competencies/${filters ? buildQueryString(filters) : ''}`;
  
  while (url) {
    // Handle both relative and absolute URLs from pagination
    const fullUrl = url.startsWith('http') ? url : `${config.baseUrl}${url}`;
    const response = await fetch(fullUrl);
    const data: PaginatedResponse<CompetencyNode> = await response.json();
    
    results.push(...data.results);
    
    // Extract relative path from next URL if it exists
    if (data.next) {
      const nextUrl = new URL(data.next);
      url = nextUrl.pathname + nextUrl.search;
    } else {
      url = null;
    }
  }
  
  return results;
}

export async function getAllArtifacts(
  filters?: ArtifactFilters
): Promise<Artifact[]> {
  const results: Artifact[] = [];
  let url: string | null = `/artifacts/${filters ? buildQueryString(filters) : ''}`;
  
  while (url) {
    const fullUrl = url.startsWith('http') ? url : `${config.baseUrl}${url}`;
    const response = await fetch(fullUrl);
    const data: PaginatedResponse<Artifact> = await response.json();
    
    results.push(...data.results);
    
    if (data.next) {
      const nextUrl = new URL(data.next);
      url = nextUrl.pathname + nextUrl.search;
    } else {
      url = null;
    }
  }
  
  return results;
}
