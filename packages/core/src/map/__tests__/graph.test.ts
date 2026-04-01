/**
 * Graph Algorithm Tests
 *
 * Tests for PageRank, connected components, shortest path, and graph builder.
 * All pure functions — no I/O, no mocks needed.
 */

import { describe, expect, it } from 'vitest';
import {
  buildDependencyGraph,
  connectedComponents,
  deserializeGraph,
  loadOrBuildGraph,
  pageRank,
  serializeGraph,
  shortestPath,
  updateGraphIncremental,
  type WeightedEdge,
} from '../graph';

function edge(target: string, weight = 1): WeightedEdge {
  return { target, weight };
}

// ============================================================================
// PageRank
// ============================================================================

describe('pageRank', () => {
  it('should rank nodes by importance', () => {
    // A -> B -> C, A -> C
    // C should rank highest (most incoming from important nodes)
    const graph = new Map<string, WeightedEdge[]>();
    graph.set('A', [edge('B'), edge('C')]);
    graph.set('B', [edge('C')]);

    const ranks = pageRank(graph);
    expect(ranks.get('C')!).toBeGreaterThan(ranks.get('A')!);
    expect(ranks.get('C')!).toBeGreaterThan(ranks.get('B')!);
  });

  it('should handle cycles', () => {
    const graph = new Map<string, WeightedEdge[]>();
    graph.set('A', [edge('B')]);
    graph.set('B', [edge('A')]);

    const ranks = pageRank(graph);
    expect(Math.abs(ranks.get('A')! - ranks.get('B')!)).toBeLessThan(0.01);
  });

  it('should handle disconnected nodes', () => {
    const graph = new Map<string, WeightedEdge[]>();
    graph.set('A', [edge('B')]);
    // B has incoming edge, C does not — B should rank higher
    graph.set('C', []);

    const ranks = pageRank(graph);
    expect(ranks.get('B')!).toBeGreaterThan(ranks.get('C')!);
  });

  it('should handle dangling nodes (no outgoing edges)', () => {
    // types.ts is imported by many but exports nothing callable
    const graph = new Map<string, WeightedEdge[]>();
    graph.set('a.ts', [edge('types.ts'), edge('b.ts')]);
    graph.set('b.ts', [edge('types.ts')]);
    // types.ts has no outgoing edges — dangling node

    const ranks = pageRank(graph);
    // types.ts should rank highest (most incoming)
    expect(ranks.get('types.ts')!).toBeGreaterThan(ranks.get('a.ts')!);
    // Dangling node's rank should be distributed, not lost
    const totalRank = Array.from(ranks.values()).reduce((a, b) => a + b, 0);
    expect(totalRank).toBeCloseTo(1.0, 2);
  });

  it('should respect edge weights', () => {
    const graph = new Map<string, WeightedEdge[]>();
    // A depends heavily on B (weight 10), lightly on C (weight 1)
    graph.set('A', [edge('B', 10), edge('C', 1)]);

    const ranks = pageRank(graph);
    expect(ranks.get('B')!).toBeGreaterThan(ranks.get('C')!);
  });

  it('should return empty map for empty graph', () => {
    expect(pageRank(new Map()).size).toBe(0);
  });

  it('should converge for large ring graph (all equal rank)', () => {
    const graph = new Map<string, WeightedEdge[]>();
    for (let i = 0; i < 100; i++) {
      graph.set(`node${i}`, [edge(`node${(i + 1) % 100}`)]);
    }
    const ranks = pageRank(graph);
    expect(ranks.size).toBe(100);

    // All nodes in a ring should have equal rank
    const values = Array.from(ranks.values());
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    for (const v of values) {
      expect(v).toBeCloseTo(avg, 4);
    }
  });

  it('should complete 2k-node graph in under 50ms', () => {
    const graph = new Map<string, WeightedEdge[]>();
    for (let i = 0; i < 2000; i++) {
      const edges: WeightedEdge[] = [];
      for (let j = 0; j < 5; j++) {
        edges.push(edge(`node${(i + j + 1) % 2000}`, 1 + (j % 3)));
      }
      graph.set(`node${i}`, edges);
    }

    const start = Date.now();
    const ranks = pageRank(graph);
    const duration = Date.now() - start;

    console.log(`PageRank: 2000 nodes, 10000 edges, ${duration}ms`);
    expect(ranks.size).toBe(2000);
    expect(duration).toBeLessThan(50);
  });
});

// ============================================================================
// buildDependencyGraph
// ============================================================================

describe('buildDependencyGraph', () => {
  it('should build weighted graph from callees metadata', () => {
    const docs = [
      {
        id: '1',
        score: 0.9,
        metadata: {
          path: 'src/a.ts',
          callees: [{ name: 'foo', file: 'src/b.ts', line: 10 }],
        },
      },
      {
        id: '2',
        score: 0.9,
        metadata: {
          path: 'src/b.ts',
          callees: [{ name: 'bar', file: 'src/c.ts', line: 5 }],
        },
      },
    ];

    const graph = buildDependencyGraph(docs);
    const aEdges = graph.get('src/a.ts')!;
    expect(aEdges.some((e) => e.target === 'src/b.ts')).toBe(true);
    expect(aEdges[0].weight).toBe(1); // sqrt(1) = 1
  });

  it('should sqrt-dampen weights for multiple references', () => {
    const docs = [
      {
        id: '1',
        score: 0.9,
        metadata: {
          path: 'src/a.ts',
          callees: [
            { name: 'foo', file: 'src/b.ts', line: 10 },
            { name: 'bar', file: 'src/b.ts', line: 20 },
            { name: 'baz', file: 'src/b.ts', line: 30 },
            { name: 'qux', file: 'src/b.ts', line: 40 },
          ],
        },
      },
    ];

    const graph = buildDependencyGraph(docs);
    const aEdges = graph.get('src/a.ts')!;
    expect(aEdges.length).toBe(1); // deduplicated to one edge
    expect(aEdges[0].target).toBe('src/b.ts');
    expect(aEdges[0].weight).toBe(2); // sqrt(4) = 2
  });

  it('should handle docs without callees metadata', () => {
    const docs = [
      { id: '1', score: 0.9, metadata: { path: 'src/types.ts', type: 'interface' } },
      {
        id: '2',
        score: 0.9,
        metadata: {
          path: 'src/a.ts',
          callees: [{ name: 'MyType', file: 'src/types.ts', line: 1 }],
        },
      },
    ];

    const graph = buildDependencyGraph(docs);
    expect(graph.get('src/a.ts')!.some((e) => e.target === 'src/types.ts')).toBe(true);
    // types.ts has no callees — it's in the graph as a source (from the doc) but with no edges
    expect(graph.get('src/types.ts')).toEqual([]);
  });

  it('should handle docs with empty callees array', () => {
    const docs = [{ id: '1', score: 0.9, metadata: { path: 'src/types.ts', callees: [] } }];

    const graph = buildDependencyGraph(docs);
    // Empty callees → no edges, but source is in the graph
    expect(graph.get('src/types.ts')).toEqual([]);
  });

  it('should exclude self-references', () => {
    const docs = [
      {
        id: '1',
        score: 0.9,
        metadata: {
          path: 'src/a.ts',
          callees: [
            { name: 'foo', file: 'src/a.ts', line: 10 }, // self-reference
            { name: 'bar', file: 'src/b.ts', line: 20 },
          ],
        },
      },
    ];

    const graph = buildDependencyGraph(docs);
    const aEdges = graph.get('src/a.ts')!;
    expect(aEdges.length).toBe(1);
    expect(aEdges[0].target).toBe('src/b.ts');
  });
});

// ============================================================================
// connectedComponents
// ============================================================================

describe('connectedComponents', () => {
  it('should identify separate clusters', () => {
    const graph = new Map<string, WeightedEdge[]>();
    // Cluster 1: A -> B -> C
    graph.set('A', [edge('B')]);
    graph.set('B', [edge('C')]);
    // Cluster 2: D -> E
    graph.set('D', [edge('E')]);

    const components = connectedComponents(graph);
    expect(components.length).toBe(2);
    expect(components[0].length).toBe(3); // A, B, C (largest first)
    expect(components[1].length).toBe(2); // D, E
  });

  it('should treat the graph as undirected', () => {
    const graph = new Map<string, WeightedEdge[]>();
    // A -> B, C -> B (B connects A and C even though edges point inward)
    graph.set('A', [edge('B')]);
    graph.set('C', [edge('B')]);

    const components = connectedComponents(graph);
    expect(components.length).toBe(1);
    expect(components[0].length).toBe(3);
  });

  it('should include target-only nodes', () => {
    // types.ts only appears as a target, never as a source key
    const graph = new Map<string, WeightedEdge[]>();
    graph.set('a.ts', [edge('types.ts')]);
    graph.set('b.ts', [edge('types.ts')]);

    const components = connectedComponents(graph);
    expect(components.length).toBe(1); // All connected through types.ts
    expect(components[0]).toContain('types.ts');
    expect(components[0].length).toBe(3);
  });

  it('should handle isolated source nodes', () => {
    const graph = new Map<string, WeightedEdge[]>();
    graph.set('A', [edge('B')]);
    graph.set('lonely', []); // Source with no edges

    const components = connectedComponents(graph);
    expect(components.length).toBe(2);
    // Largest first: A+B (2), then lonely (1)
    expect(components[0].length).toBe(2);
    expect(components[1]).toEqual(['lonely']);
  });

  it('should return empty for empty graph', () => {
    expect(connectedComponents(new Map()).length).toBe(0);
  });
});

// ============================================================================
// shortestPath
// ============================================================================

describe('shortestPath', () => {
  it('should find direct path', () => {
    const graph = new Map<string, WeightedEdge[]>();
    graph.set('A', [edge('B')]);

    expect(shortestPath(graph, 'A', 'B')).toEqual(['A', 'B']);
  });

  it('should find multi-hop path', () => {
    const graph = new Map<string, WeightedEdge[]>();
    graph.set('A', [edge('B')]);
    graph.set('B', [edge('C')]);
    graph.set('C', [edge('D')]);

    expect(shortestPath(graph, 'A', 'D')).toEqual(['A', 'B', 'C', 'D']);
  });

  it('should find shortest among multiple paths', () => {
    const graph = new Map<string, WeightedEdge[]>();
    // A -> B -> D (2 hops) and A -> C -> X -> D (3 hops)
    graph.set('A', [edge('B'), edge('C')]);
    graph.set('B', [edge('D')]);
    graph.set('C', [edge('X')]);
    graph.set('X', [edge('D')]);

    const path = shortestPath(graph, 'A', 'D');
    expect(path).toEqual(['A', 'B', 'D']); // Shortest: 2 hops
  });

  it('should return null for unreachable target', () => {
    const graph = new Map<string, WeightedEdge[]>();
    graph.set('A', [edge('B')]);
    graph.set('C', [edge('D')]); // Disconnected

    expect(shortestPath(graph, 'A', 'D')).toBeNull();
  });

  it('should return single-node path for self', () => {
    const graph = new Map<string, WeightedEdge[]>();
    graph.set('A', [edge('B')]);

    expect(shortestPath(graph, 'A', 'A')).toEqual(['A']);
  });

  it('should return null for unknown source', () => {
    expect(shortestPath(new Map(), 'X', 'Y')).toBeNull();
  });
});

// ============================================================================
// Serialization
// ============================================================================

describe('serializeGraph / deserializeGraph', () => {
  it('should round-trip correctly', () => {
    const graph = new Map<string, WeightedEdge[]>();
    graph.set('src/a.ts', [edge('src/b.ts', 1.5), edge('src/c.ts', 1)]);
    graph.set('src/b.ts', [edge('src/c.ts', 2)]);

    const json = serializeGraph(graph);
    const restored = deserializeGraph(json);

    expect(restored).not.toBeNull();
    expect(restored!.size).toBe(2);
    expect(restored!.get('src/a.ts')).toEqual([
      { target: 'src/b.ts', weight: 1.5 },
      { target: 'src/c.ts', weight: 1 },
    ]);
    expect(restored!.get('src/b.ts')).toEqual([{ target: 'src/c.ts', weight: 2 }]);
  });

  it('should include metadata in serialized JSON', () => {
    const graph = new Map<string, WeightedEdge[]>();
    graph.set('a', [edge('b')]);

    const parsed = JSON.parse(serializeGraph(graph));
    expect(parsed.version).toBe(1);
    expect(parsed.nodeCount).toBe(1);
    expect(parsed.edgeCount).toBe(1);
    expect(parsed.generatedAt).toBeTruthy();
  });

  it('should return null for invalid JSON', () => {
    expect(deserializeGraph('not json')).toBeNull();
  });

  it('should return null for wrong version', () => {
    const json = JSON.stringify({ version: 99, graph: {} });
    expect(deserializeGraph(json)).toBeNull();
  });

  it('should return null for missing graph field', () => {
    const json = JSON.stringify({ version: 1 });
    expect(deserializeGraph(json)).toBeNull();
  });

  it('should handle empty graph', () => {
    const graph = new Map<string, WeightedEdge[]>();
    const json = serializeGraph(graph);
    const restored = deserializeGraph(json);
    expect(restored).not.toBeNull();
    expect(restored!.size).toBe(0);
  });
});

// ============================================================================
// loadOrBuildGraph
// ============================================================================

describe('loadOrBuildGraph', () => {
  it('should call fallback when graphPath is undefined', async () => {
    const fallbackDocs = [
      {
        id: '1',
        score: 0,
        metadata: {
          path: 'src/a.ts',
          callees: [{ name: 'foo', file: 'src/b.ts', line: 1 }],
        },
      },
    ];

    const graph = await loadOrBuildGraph(undefined, async () => fallbackDocs);
    expect(graph.get('src/a.ts')).toBeDefined();
  });

  it('should call fallback when graphPath file does not exist', async () => {
    const fallbackDocs = [
      {
        id: '1',
        score: 0,
        metadata: {
          path: 'src/x.ts',
          callees: [{ name: 'bar', file: 'src/y.ts', line: 1 }],
        },
      },
    ];

    const graph = await loadOrBuildGraph('/nonexistent/path.json', async () => fallbackDocs);
    expect(graph.get('src/x.ts')).toBeDefined();
  });
});

// ============================================================================
// updateGraphIncremental
// ============================================================================

describe('updateGraphIncremental', () => {
  it('should add edges for new files', () => {
    const existing = new Map<string, WeightedEdge[]>();
    existing.set('src/a.ts', [edge('src/b.ts')]);

    const changedDocs = [
      {
        id: '1',
        score: 0,
        metadata: {
          path: 'src/c.ts',
          callees: [{ name: 'foo', file: 'src/d.ts', line: 1 }],
        },
      },
    ];

    const updated = updateGraphIncremental(existing, changedDocs, []);
    expect(updated.get('src/a.ts')).toBeDefined(); // Kept
    expect(updated.get('src/c.ts')).toBeDefined(); // Added
  });

  it('should remove edges for deleted files', () => {
    const existing = new Map<string, WeightedEdge[]>();
    existing.set('src/a.ts', [edge('src/b.ts')]);
    existing.set('src/b.ts', [edge('src/c.ts')]);

    const updated = updateGraphIncremental(existing, [], ['src/a.ts']);
    expect(updated.has('src/a.ts')).toBe(false); // Removed
    expect(updated.get('src/b.ts')).toBeDefined(); // Kept
  });

  it('should replace edges for changed files', () => {
    const existing = new Map<string, WeightedEdge[]>();
    existing.set('src/a.ts', [edge('src/old.ts')]);

    const changedDocs = [
      {
        id: '1',
        score: 0,
        metadata: {
          path: 'src/a.ts',
          callees: [{ name: 'foo', file: 'src/new.ts', line: 1 }],
        },
      },
    ];

    const updated = updateGraphIncremental(existing, changedDocs, []);
    const edges = updated.get('src/a.ts')!;
    expect(edges.length).toBe(1);
    expect(edges[0].target).toBe('src/new.ts'); // Replaced
  });

  it('should not mutate the existing graph', () => {
    const existing = new Map<string, WeightedEdge[]>();
    existing.set('src/a.ts', [edge('src/b.ts')]);

    updateGraphIncremental(existing, [], ['src/a.ts']);
    expect(existing.has('src/a.ts')).toBe(true); // Original unchanged
  });

  it('should handle empty existing graph', () => {
    const changedDocs = [
      {
        id: '1',
        score: 0,
        metadata: {
          path: 'src/a.ts',
          callees: [{ name: 'foo', file: 'src/b.ts', line: 1 }],
        },
      },
    ];

    const updated = updateGraphIncremental(new Map(), changedDocs, []);
    expect(updated.get('src/a.ts')).toBeDefined();
  });
});
