/**
 * Zod schemas for MCP adapter validation
 *
 * Following TypeScript Standards Rule #2: No Type Assertions Without Validation
 * See: docs/TYPESCRIPT_STANDARDS.md
 */

import { z } from 'zod';

// ============================================================================
// Shared Base Schemas
// ============================================================================

/**
 * Common format option for output
 */
export const FormatSchema = z.enum(['compact', 'verbose']);

/**
 * Base schema for queries with pagination and formatting
 */
export const BaseQuerySchema = z.object({
  format: FormatSchema.default('compact'),
  limit: z.number().int().min(1).max(50).default(10),
});

// ============================================================================
// Inspect Adapter
// ============================================================================

export const InspectArgsSchema = z
  .object({
    filePath: z.string().min(1, 'filePath must be a non-empty file path'),
    limit: z.number().int().min(1).max(50).default(10),
    format: z.enum(['compact', 'verbose', 'json']).default('compact'),
  })
  .strict(); // Reject unknown properties

export type InspectArgs = z.infer<typeof InspectArgsSchema>;

// ============================================================================
// Search Adapter
// ============================================================================

export const SearchArgsSchema = z
  .object({
    query: z.string().min(1, 'Query must be a non-empty string'),
    format: FormatSchema.default('compact'),
    limit: z.number().int().min(1).max(50).default(10),
    scoreThreshold: z.number().min(0).max(1).default(0),
    tokenBudget: z.number().int().min(500).max(10000).optional(),
  })
  .strict();

export type SearchArgs = z.infer<typeof SearchArgsSchema>;

// ============================================================================
// Refs Adapter
// ============================================================================

export const RefsArgsSchema = z
  .object({
    name: z.string().min(1, 'Name must be a non-empty string'),
    direction: z.enum(['callees', 'callers', 'both']).default('both'),
    limit: z.number().int().min(1).max(50).default(20),
    traceTo: z.string().optional(),
  })
  .strict();

export type RefsArgs = z.infer<typeof RefsArgsSchema>;

// ============================================================================
// Map Adapter
// ============================================================================

export const MapArgsSchema = z
  .object({
    depth: z.number().int().min(1).max(5).default(2),
    focus: z.string().optional(),
    includeExports: z.boolean().default(true),
    includeChangeFrequency: z.boolean().default(false),
    tokenBudget: z.number().int().min(500).max(10000).default(2000),
  })
  .strict();

export type MapArgs = z.infer<typeof MapArgsSchema>;

// ============================================================================
// Status Adapter
// ============================================================================

export const StatusArgsSchema = z
  .object({
    format: FormatSchema.default('compact'),
    section: z.enum(['summary', 'repo', 'indexes', 'health']).default('summary'),
  })
  .strict();

export type StatusArgs = z.infer<typeof StatusArgsSchema>;

/**
 * Status output schema
 */
export const StatusOutputSchema = z.object({
  content: z.string(),
  section: z.string(),
  format: z.string(),
  length: z.number(),
});

export type StatusOutput = z.infer<typeof StatusOutputSchema>;

// ============================================================================
// Output Schemas (Runtime validation for adapter responses)
// ============================================================================

/**
 * Search output schema
 */
export const SearchOutputSchema = z.object({
  query: z.string(),
  format: z.string(),
  content: z.string(),
});

export type SearchOutput = z.infer<typeof SearchOutputSchema>;

/**
 * Map output schema
 */
export const MapOutputSchema = z.object({
  content: z.string(),
  totalComponents: z.number(),
  totalDirectories: z.number(),
  depth: z.number(),
  focus: z.string().nullable(),
  truncated: z.boolean(),
});

export type MapOutput = z.infer<typeof MapOutputSchema>;

/**
 * Refs result schema (some fields may be undefined in practice)
 */
export const RefResultSchema = z.object({
  name: z.string(),
  file: z.string().optional(),
  line: z.number().optional(),
  type: z.string().optional(),
});

export const RefsOutputSchema = z.object({
  name: z.string(),
  direction: z.string(),
  content: z.string(),
  target: z.object({
    name: z.string(),
    file: z.string(),
    line: z.number(),
    type: z.string(),
  }),
  callees: z.array(RefResultSchema).optional(),
  callers: z.array(RefResultSchema).optional(),
});

export type RefsOutput = z.infer<typeof RefsOutputSchema>;

/**
 * Inspect output schema
 */
export const InspectOutputSchema = z.object({
  query: z.string(),
  format: z.string(),
  markdown: z.string(),
  similarFilesCount: z.number(),
  patternsAnalyzed: z.number(),
});

export type InspectOutput = z.infer<typeof InspectOutputSchema>;
