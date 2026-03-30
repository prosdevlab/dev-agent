/**
 * Services Module
 *
 * Shared business logic layer for MCP and Dashboard.
 * Provides consistent APIs for stats, health, and metrics.
 */

export { CoordinatorService, type CoordinatorServiceConfig } from './coordinator-service.js';
export {
  type ComponentHealth,
  type HealthCheckResult,
  HealthService,
  type HealthServiceConfig,
} from './health-service.js';
export { MetricsService, type MetricsServiceConfig } from './metrics-service.js';
export {
  type ErrorHandlingComparison,
  type ErrorHandlingPattern,
  type FilePatterns,
  type FileSizeComparison,
  type FileSizePattern,
  type ImportStyleComparison,
  type ImportStylePattern,
  type PatternAnalysisConfig,
  PatternAnalysisService,
  type PatternComparison,
  type TestingComparison,
  type TestingPattern,
  type TypeAnnotationComparison,
  type TypeAnnotationPattern,
} from './pattern-analysis-service.js';
export {
  SearchService,
  type SearchServiceConfig,
  type SimilarityOptions,
} from './search-service.js';
