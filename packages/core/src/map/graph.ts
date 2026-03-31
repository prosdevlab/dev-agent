/**
 * Graph Algorithms for Codebase Analysis
 *
 * Pure functions over the file dependency graph:
 * - PageRank: file importance ranking (replaces simple ref counting)
 * - Connected components: subsystem identification
 * - Shortest path: call chain tracing
 * - Graph builder: constructs weighted graph from indexed callees
 *
 * Inspired by aider's repo map (https://github.com/Aider-AI/aider)
 * which uses NetworkX PageRank over a weighted dependency graph.
 */

import type { SearchResult } from '../vector/types';

// ============================================================================
// Types
// ============================================================================

export interface WeightedEdge {
  target: string;
  weight: number;
}

// ============================================================================
// Graph Builder
// ============================================================================

/**
 * Build a weighted file dependency graph from indexed documents.
 * Uses callees metadata: file A calls N things in file B → edge weight = sqrt(N).
 * sqrt dampening (from aider) prevents high-frequency references from dominating.
 *
 * Note: `callers` metadata is NOT stored in the index (computed at query time
 * by refs adapter). Only `callees` produces real data for indexed docs.
 */
export function buildDependencyGraph(docs: SearchResult[]): Map<string, WeightedEdge[]> {
  // Count raw references per (source, target) pair
  const rawCounts = new Map<string, Map<string, number>>();

  for (const doc of docs) {
    const sourceFile = (doc.metadata.path as string) || (doc.metadata.file as string);
    if (!sourceFile) continue;

    if (!rawCounts.has(sourceFile)) rawCounts.set(sourceFile, new Map());

    const callees = doc.metadata.callees as Array<{ file?: string }> | undefined;
    if (callees && Array.isArray(callees)) {
      for (const callee of callees) {
        if (callee.file && callee.file !== sourceFile) {
          const targets = rawCounts.get(sourceFile)!;
          targets.set(callee.file, (targets.get(callee.file) || 0) + 1);
        }
      }
    }
  }

  // Convert to weighted edges with sqrt dampening
  const graph = new Map<string, WeightedEdge[]>();
  for (const [source, targets] of rawCounts) {
    const edges: WeightedEdge[] = [];
    for (const [target, count] of targets) {
      edges.push({ target, weight: Math.sqrt(count) });
    }
    graph.set(source, edges);
  }

  return graph;
}

// ============================================================================
// PageRank
// ============================================================================

/**
 * Weighted PageRank with dangling node handling and convergence.
 *
 * Standard algorithm: damping 0.85, max 100 iterations, tolerance 1e-6.
 * Matches NetworkX defaults used by aider.
 *
 * Dangling nodes (files with no outgoing edges, e.g. types.ts) distribute
 * their rank equally to all nodes — standard PageRank behavior.
 */
export function pageRank(
  graph: Map<string, WeightedEdge[]>,
  damping = 0.85,
  maxIterations = 100,
  tolerance = 1e-6
): Map<string, number> {
  // Collect all nodes (sources + targets)
  const nodes = new Set<string>();
  for (const [src, edges] of graph) {
    nodes.add(src);
    for (const e of edges) nodes.add(e.target);
  }

  if (nodes.size === 0) return new Map();

  const n = nodes.size;
  let ranks = new Map<string, number>();

  // Initialize equal rank
  for (const node of nodes) ranks.set(node, 1 / n);

  // Build inbound map: target → [{ source, weight }]
  const inbound = new Map<string, Array<{ source: string; weight: number }>>();
  for (const node of nodes) inbound.set(node, []);

  // Build outgoing weight sums for normalization
  const outWeightSum = new Map<string, number>();
  for (const [src, edges] of graph) {
    let sum = 0;
    for (const e of edges) {
      inbound.get(e.target)?.push({ source: src, weight: e.weight });
      sum += e.weight;
    }
    outWeightSum.set(src, sum);
  }

  // Identify dangling nodes (no outgoing edges)
  const danglingNodes: string[] = [];
  for (const node of nodes) {
    if (!outWeightSum.has(node) || outWeightSum.get(node) === 0) {
      danglingNodes.push(node);
    }
  }

  // Iterate until convergence or max iterations
  for (let iter = 0; iter < maxIterations; iter++) {
    const newRanks = new Map<string, number>();

    // Dangling rank: sum of dangling nodes' ranks, distributed to all
    let danglingRank = 0;
    for (const d of danglingNodes) danglingRank += ranks.get(d) || 0;

    for (const node of nodes) {
      let sum = 0;
      for (const { source, weight } of inbound.get(node) || []) {
        const srcOutWeight = outWeightSum.get(source) || 1;
        sum += ((ranks.get(source) || 0) * weight) / srcOutWeight;
      }
      // Standard PageRank formula with dangling node contribution
      newRanks.set(node, (1 - damping) / n + damping * (sum + danglingRank / n));
    }

    // Check convergence (L1 norm)
    let delta = 0;
    for (const node of nodes) {
      delta += Math.abs((newRanks.get(node) || 0) - (ranks.get(node) || 0));
    }

    ranks = newRanks;
    if (delta < tolerance) break;
  }

  return ranks;
}

// ============================================================================
// Connected Components
// ============================================================================

/**
 * Find connected components in the dependency graph (undirected).
 * Returns groups of files sorted by size (largest first).
 *
 * Treats the directed graph as undirected: if A depends on B,
 * A and B are in the same component regardless of edge direction.
 */
export function connectedComponents(graph: Map<string, WeightedEdge[]>): string[][] {
  // Build undirected adjacency list from all nodes
  const adj = new Map<string, Set<string>>();
  const allNodes = new Set<string>();

  for (const [src, edges] of graph) {
    allNodes.add(src);
    if (!adj.has(src)) adj.set(src, new Set());
    for (const e of edges) {
      allNodes.add(e.target);
      if (!adj.has(e.target)) adj.set(e.target, new Set());
      adj.get(src)!.add(e.target);
      adj.get(e.target)!.add(src);
    }
  }

  const visited = new Set<string>();
  const components: string[][] = [];

  for (const node of allNodes) {
    if (visited.has(node)) continue;

    // BFS from this node
    const component: string[] = [];
    const queue = [node];
    visited.add(node);

    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      for (const neighbor of adj.get(current) || []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    components.push(component);
  }

  // Sort by size (largest first)
  return components.sort((a, b) => b.length - a.length);
}

// ============================================================================
// Shortest Path
// ============================================================================

/**
 * Find shortest path between two files in the dependency graph.
 * Uses BFS (hop count, not edge weight).
 * Returns the path as an array of files, or null if unreachable.
 */
export function shortestPath(
  graph: Map<string, WeightedEdge[]>,
  from: string,
  to: string
): string[] | null {
  if (from === to) return [from];
  if (!graph.has(from)) return null;

  const visited = new Set<string>([from]);
  const parent = new Map<string, string>();
  const queue = [from];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const { target } of graph.get(current) || []) {
      if (visited.has(target)) continue;
      visited.add(target);
      parent.set(target, current);

      if (target === to) {
        // Reconstruct path
        const path = [to];
        let node = to;
        while (parent.has(node)) {
          node = parent.get(node)!;
          path.unshift(node);
        }
        return path;
      }

      queue.push(target);
    }
  }

  return null;
}
