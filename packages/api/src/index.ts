// API Client
export {
  // Config
  configureApi,
  getApiConfig,
  type ApiConfig,
  
  // Error
  ApiError,
  
  // Types
  type PaginatedResponse,
  type Category,
  type CompetencyFilters,
  type ArtifactFilters,
  
  // Category endpoints
  getCategories,
  getCategory,
  
  // Competency endpoints
  getCompetencies,
  getCompetency,
  getCompetenciesByCategory,
  getHighlightedCompetencies,
  searchCompetencies,
  getAllCompetencies,
  
  // Artifact endpoints
  getArtifacts,
  getArtifact,
  getArtifactsByStatus,
  getArtifactsByTech,
  searchArtifacts,
  getAllArtifacts,
} from './client';
