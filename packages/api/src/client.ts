import type {
  CompetencyNode,
  Artifact,
  Proficiency,
  CompetencyType,
  ArtifactStatus,
  ArtifactDomain,
  DemoType,
} from '@atlas/types';

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

export interface Category {
  id: number;
  name: string;
  description: string;
  display_order: number;
}

export interface CompetencyFilters {
  category?: number | string;
  competency_type?: CompetencyType;
  proficiency?: Proficiency;
  portfolio_highlight?: boolean;
  search?: string;
}

export interface ArtifactFilters {
  status?: ArtifactStatus;
  domain?: ArtifactDomain;
  demo_type?: DemoType;
  tech_stack?: string;
  search?: string;
}

async function apiFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
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
      } catch {}
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

export async function getCategories(): Promise<Category[]> {
  return apiFetch<Category[]>('/categories/');
}

export async function getCategory(id: number | string): Promise<Category> {
  return apiFetch<Category>(`/categories/${id}/`);
}

export async function getCompetencies(filters?: CompetencyFilters): Promise<CompetencyNode[]> {
  const query = filters ? buildQueryString(filters as Record<string, unknown>) : '';
  return apiFetch<CompetencyNode[]>(`/competencies/${query}`);
}

export async function getCompetency(id: number | string): Promise<CompetencyNode> {
  return apiFetch<CompetencyNode>(`/competencies/${id}/`);
}

export async function getCompetenciesByCategory(
  categoryId: number | string
): Promise<CompetencyNode[]> {
  return getCompetencies({ category: categoryId });
}

export async function getHighlightedCompetencies(): Promise<CompetencyNode[]> {
  return getCompetencies({ portfolio_highlight: true });
}

export async function searchCompetencies(query: string): Promise<CompetencyNode[]> {
  return getCompetencies({ search: query });
}

export async function getArtifacts(filters?: ArtifactFilters): Promise<Artifact[]> {
  const query = filters ? buildQueryString(filters as Record<string, unknown>) : '';
  return apiFetch<Artifact[]>(`/artifacts/${query}`);
}

export async function getArtifact(id: number | string): Promise<Artifact> {
  return apiFetch<Artifact>(`/artifacts/${id}/`);
}

export async function getArtifactsByStatus(status: ArtifactStatus): Promise<Artifact[]> {
  return getArtifacts({ status });
}

export async function getArtifactsByTech(tech: string): Promise<Artifact[]> {
  return getArtifacts({ tech_stack: tech });
}

export async function searchArtifacts(query: string): Promise<Artifact[]> {
  return getArtifacts({ search: query });
}
