/**
 * Reverse Callee Index
 *
 * Maps callee names to the components that call them.
 * Enables efficient "find all callers" queries — replaces the broken
 * semantic-search-then-scan approach in dev_refs.
 *
 * Pure functions — no I/O, no side effects, trivially testable.
 */

import type { CalleeInfo } from '../scanner/types.js';
import type { SearchResult } from '../vector/types.js';
import type { CallerEntry } from './types.js';

// ============================================================================
// Build
// ============================================================================

/**
 * Build reverse callee index from indexed documents.
 * Key format: "file:name" (compound) when callee file is resolved,
 * bare "name" when not (tree-sitter languages without file resolution).
 */
export function buildReverseCalleeIndex(docs: SearchResult[]): Map<string, CallerEntry[]> {
  const index = new Map<string, CallerEntry[]>();

  for (const doc of docs) {
    const callees = doc.metadata.callees as CalleeInfo[] | undefined;
    if (!callees || callees.length === 0) continue;

    const callerName = typeof doc.metadata.name === 'string' ? doc.metadata.name : 'unknown';
    const callerFile = typeof doc.metadata.path === 'string' ? doc.metadata.path : '';
    const callerType = typeof doc.metadata.type === 'string' ? doc.metadata.type : 'unknown';

    for (const callee of callees) {
      const key = callee.file ? `${callee.file}:${callee.name}` : callee.name;

      const entry: CallerEntry = {
        name: callerName,
        file: callerFile,
        line: callee.line,
        type: callerType,
      };

      const existing = index.get(key);
      if (existing) {
        existing.push(entry);
      } else {
        index.set(key, [entry]);
      }
    }
  }

  return index;
}

// ============================================================================
// Name Index (secondary index for bare-name lookups)
// ============================================================================

/**
 * Build secondary name index for bare-name lookups.
 * Maps name segments to the full compound keys they appear in.
 *
 * "src/validate.ts:validateArgs" → indexed under "validateArgs"
 * "src/search.ts:this.searchService.search" → indexed under "search", "this.searchService.search"
 * "new CompactFormatter" → indexed under "CompactFormatter"
 * "src/a.ts:ClassName.method" → indexed under "method", "ClassName.method", "ClassName"
 *
 * Built in memory at load time. Not persisted.
 */
export function buildNameIndex(reverseIndex: Map<string, CallerEntry[]>): Map<string, string[]> {
  const nameIndex = new Map<string, string[]>();

  for (const key of reverseIndex.keys()) {
    // Extract name from compound key "file:name" or bare "name"
    const colonIdx = key.lastIndexOf(':');
    const name = colonIdx >= 0 ? key.slice(colonIdx + 1) : key;
    // Handle "new Foo" → "Foo"
    const cleaned = name.startsWith('new ') ? name.slice(4) : name;
    // Handle qualified: "this.service.search" → "search"
    const dotIdx = cleaned.lastIndexOf('.');
    const lastSegment = dotIdx >= 0 ? cleaned.slice(dotIdx + 1) : cleaned;

    const segments = new Set([cleaned, lastSegment]);

    // For "ClassName.method", also index under "ClassName" for class aggregation
    if (cleaned.includes('.')) {
      const classPrefix = cleaned.split('.')[0];
      segments.add(classPrefix);
    }

    for (const segment of segments) {
      const existing = nameIndex.get(segment);
      if (existing) {
        existing.push(key);
      } else {
        nameIndex.set(segment, [key]);
      }
    }
  }

  return nameIndex;
}

// ============================================================================
// Lookup
// ============================================================================

/**
 * Deduplicate caller entries by file+name, cap at limit.
 */
function deduplicateCallers(candidates: CallerEntry[], limit: number): CallerEntry[] {
  const seen = new Set<string>();
  const results: CallerEntry[] = [];
  for (const entry of candidates) {
    const key = `${entry.file}:${entry.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(entry);
    if (results.length >= limit) break;
  }
  return results;
}

/**
 * Look up callers of a target from the reverse callee index.
 *
 * 1. Try compound key: "targetFile:targetName" → O(1)
 * 2. Fall back to nameIndex for bare-name resolution → O(1)
 * 3. Deduplicate by caller file+name, cap at limit
 */
export function lookupCallers(
  reverseIndex: Map<string, CallerEntry[]>,
  nameIndex: Map<string, string[]>,
  targetName: string,
  targetFile: string,
  limit = 50
): CallerEntry[] {
  const candidates: CallerEntry[] = [];

  // 1. Compound key — exact match, O(1)
  const compoundKey = `${targetFile}:${targetName}`;
  const exact = reverseIndex.get(compoundKey);
  if (exact) candidates.push(...exact);

  // 2. Bare name — use name index for O(1) resolution
  const fullKeys = nameIndex.get(targetName) ?? [];
  for (const key of fullKeys) {
    if (key === compoundKey) continue; // already collected
    const entries = reverseIndex.get(key);
    if (entries) candidates.push(...entries);
  }

  return deduplicateCallers(candidates, limit);
}

/**
 * Look up callers of a class, aggregating across constructor and methods.
 * The nameIndex indexes "ClassName.method" keys under "ClassName",
 * so a single O(1) lookup returns all constructor + method compound keys.
 */
export function lookupClassCallers(
  reverseIndex: Map<string, CallerEntry[]>,
  nameIndex: Map<string, string[]>,
  className: string,
  _classFile: string,
  limit = 50
): CallerEntry[] {
  const candidates: CallerEntry[] = [];

  // nameIndex indexes "ClassName.method" under "ClassName" prefix,
  // and "new ClassName" under "ClassName". Single O(1) lookup.
  const fullKeys = nameIndex.get(className) ?? [];
  for (const key of fullKeys) {
    const entries = reverseIndex.get(key);
    if (entries) candidates.push(...entries);
  }

  return deduplicateCallers(candidates, limit);
}

// ============================================================================
// Incremental Update
// ============================================================================

/**
 * Incrementally update the reverse callee index.
 *
 * 1. Deep copy existing (don't mutate original)
 * 2. Remove entries where caller file is in changedFiles or deletedFiles
 * 3. Remove compound keys whose file is in deletedFiles
 * 4. Rebuild entries from changedDocs
 *
 * Returns a new map (does not mutate existing).
 */
export function updateReverseIndexIncremental(
  existing: Map<string, CallerEntry[]>,
  changedDocs: SearchResult[],
  deletedFiles: string[]
): Map<string, CallerEntry[]> {
  // Deep copy — shallow Map copy shares CallerEntry[] references
  const updated = new Map<string, CallerEntry[]>();
  for (const [key, entries] of existing) {
    updated.set(key, [...entries]);
  }

  const removedFiles = new Set(deletedFiles);

  // Collect files from changed docs
  const changedFiles = new Set<string>();
  for (const doc of changedDocs) {
    const file = doc.metadata.path as string;
    if (file) changedFiles.add(file);
  }

  // Remove stale entries
  for (const [key, entries] of updated) {
    // Remove compound keys whose file is deleted
    const colonIdx = key.lastIndexOf(':');
    if (colonIdx >= 0) {
      const keyFile = key.slice(0, colonIdx);
      if (removedFiles.has(keyFile)) {
        updated.delete(key);
        continue;
      }
    }

    // Filter out caller entries from changed/deleted files
    const filtered = entries.filter(
      (entry) => !changedFiles.has(entry.file) && !removedFiles.has(entry.file)
    );

    if (filtered.length === 0) {
      updated.delete(key);
    } else {
      updated.set(key, filtered);
    }
  }

  // Rebuild entries from changed docs
  const newEntries = buildReverseCalleeIndex(changedDocs);
  for (const [key, entries] of newEntries) {
    const current = updated.get(key);
    if (current) {
      current.push(...entries);
    } else {
      updated.set(key, [...entries]);
    }
  }

  return updated;
}
