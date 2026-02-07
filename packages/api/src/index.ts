// API Client
export {
  // config
  configureApi,
  getApiConfig,
  type ApiConfig,

  // error
  ApiError,

  // types
  type Category,
  type CompetencyFilters,
  type ArtifactFilters,

  // category endpoints
  getCategories,
  getCategory,

  // competency endpoints
  getCompetencies,
  getCompetency,
  getCompetenciesByCategory,
  getHighlightedCompetencies,
  searchCompetencies,

  // artifact endpoints
  getArtifacts,
  getArtifact,
  getArtifactsByStatus,
  getArtifactsByTech,
  searchArtifacts,
} from './client';
