/**
 * Codebase Map Types
 * Types for representing codebase structure
 */

/**
 * Change frequency data for a node
 */
export interface ChangeFrequency {
  /** Number of commits in the last 30 days */
  last30Days: number;
  /** Number of commits in the last 90 days */
  last90Days: number;
  /** Date of the most recent commit */
  lastCommit?: string;
}

/**
 * A node in the codebase map tree
 */
export interface MapNode {
  /** Directory or file name */
  name: string;
  /** Full path from repository root */
  path: string;
  /** Number of indexed components in this node (recursive) */
  componentCount: number;
  /** Child nodes (subdirectories) */
  children: MapNode[];
  /** Exported symbols from this directory (if includeExports is true) */
  exports?: ExportInfo[];
  /** Whether this is a leaf node (file, not directory) */
  isFile?: boolean;
  /** Change frequency data (if includeChangeFrequency is true) */
  changeFrequency?: ChangeFrequency;
}

/**
 * Information about an exported symbol
 */
export interface ExportInfo {
  /** Symbol name */
  name: string;
  /** Type of export (function, class, interface, type) */
  type: string;
  /** File where it's defined */
  file: string;
  /** Function/method signature (if available) */
  signature?: string;
}

/**
 * Options for generating a codebase map
 */
export interface MapOptions {
  /** Maximum depth to traverse (1-5, default: 2) */
  depth?: number;
  /** Focus on a specific directory path */
  focus?: string;
  /** Include exported symbols (default: true) */
  includeExports?: boolean;
  /** Maximum exports to show per directory (default: 5) */
  maxExportsPerDir?: number;
  /** Include hot paths - most referenced files (default: true) */
  includeHotPaths?: boolean;
  /** Maximum hot paths to show (default: 5) */
  maxHotPaths?: number;
  /** Use smart depth - expand dense directories, collapse sparse ones (default: false) */
  smartDepth?: boolean;
  /** Minimum components to expand a directory when using smart depth (default: 10) */
  smartDepthThreshold?: number;
  /** Token budget for output (default: 2000) */
  tokenBudget?: number;
  /** Include change frequency data (default: false) */
  includeChangeFrequency?: boolean;
  /** Repository path for stripping absolute paths in output */
  repositoryPath?: string;
}

/**
 * Information about a frequently referenced file
 */
export interface HotPath {
  /** File path */
  file: string;
  /** Number of distinct files that depend on this file */
  incomingRefs: number;
  /** PageRank score (used for sorting — higher = more architecturally central) */
  score: number;
  /** Primary component name in this file */
  primaryComponent?: string;
}

/**
 * Entry in the reverse callee index — represents a caller of a function/method.
 */
export interface CallerEntry {
  /** Caller component name (e.g., "SearchAdapter.execute") */
  name: string;
  /** Caller file path */
  file: string;
  /** Call site line in caller */
  line: number;
  /** Caller component type (function, method, class) */
  type: string;
}

/**
 * Result of codebase map generation
 */
export interface CodebaseMap {
  /** Root node of the map tree */
  root: MapNode;
  /** Total number of indexed components */
  totalComponents: number;
  /** Total number of directories */
  totalDirectories: number;
  /** Most referenced files (hot paths) */
  hotPaths: HotPath[];
  /** Connected subsystems (groups of interdependent files) */
  components?: Array<{ files: string[]; size: number }>;
  /** Generation timestamp */
  generatedAt: string;
}
