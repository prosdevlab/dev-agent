/**
 * Reverse Callee Index Tests
 *
 * All pure functions — no I/O, no mocks needed.
 */

import { describe, expect, it } from 'vitest';
import type { SearchResult } from '../../vector/types';
import {
  buildNameIndex,
  buildReverseCalleeIndex,
  lookupCallers,
  lookupClassCallers,
  updateReverseIndexIncremental,
} from '../reverse-index';
import type { CallerEntry } from '../types';

// Helper to create mock documents
function mockDoc(
  filePath: string,
  name: string,
  type: string,
  callees: Array<{ name: string; line: number; file?: string }>
): SearchResult {
  return {
    id: `${filePath}:${name}:1`,
    score: 0,
    metadata: {
      path: filePath,
      name,
      type,
      callees,
    },
  };
}

// ============================================================================
// buildReverseCalleeIndex
// ============================================================================

describe('buildReverseCalleeIndex', () => {
  it('should map compound keys for resolved callees', () => {
    const docs = [
      mockDoc('src/a.ts', 'funcA', 'function', [
        { name: 'validateArgs', line: 5, file: 'src/validate.ts' },
        { name: 'console.log', line: 10 },
      ]),
      mockDoc('src/b.ts', 'funcB', 'function', [
        { name: 'validateArgs', line: 3, file: 'src/validate.ts' },
      ]),
    ];

    const index = buildReverseCalleeIndex(docs);

    // Compound key for resolved file
    expect(index.get('src/validate.ts:validateArgs')).toHaveLength(2);
    // Bare name key for unresolved
    expect(index.get('console.log')).toHaveLength(1);
    expect(index.get('console.log')![0].name).toBe('funcA');
  });

  it('should store caller metadata correctly', () => {
    const docs = [
      mockDoc('src/adapter.ts', 'SearchAdapter.execute', 'method', [
        { name: 'validateArgs', line: 124, file: 'src/validate.ts' },
      ]),
    ];

    const index = buildReverseCalleeIndex(docs);
    const callers = index.get('src/validate.ts:validateArgs')!;

    expect(callers[0]).toEqual({
      name: 'SearchAdapter.execute',
      file: 'src/adapter.ts',
      line: 124,
      type: 'method',
    });
  });

  it('should handle docs with no callees', () => {
    const docs = [mockDoc('src/a.ts', 'MyInterface', 'interface', [])];
    const index = buildReverseCalleeIndex(docs);
    expect(index.size).toBe(0);
  });

  it('should handle docs with undefined callees', () => {
    const docs: SearchResult[] = [
      { id: 'test', score: 0, metadata: { path: 'a.ts', name: 'func' } },
    ];
    const index = buildReverseCalleeIndex(docs);
    expect(index.size).toBe(0);
  });

  it('should handle empty docs array', () => {
    const index = buildReverseCalleeIndex([]);
    expect(index.size).toBe(0);
  });
});

// ============================================================================
// buildNameIndex
// ============================================================================

describe('buildNameIndex', () => {
  it('should map last segment to compound keys', () => {
    const reverseIndex = new Map<string, CallerEntry[]>([
      ['src/validate.ts:validateArgs', []],
      ['src/search.ts:this.searchService.search', []],
      ['new CompactFormatter', []],
    ]);

    const nameIndex = buildNameIndex(reverseIndex);

    expect(nameIndex.get('validateArgs')).toContain('src/validate.ts:validateArgs');
    expect(nameIndex.get('search')).toContain('src/search.ts:this.searchService.search');
    expect(nameIndex.get('CompactFormatter')).toContain('new CompactFormatter');
  });

  it('should index qualified names under class prefix', () => {
    const reverseIndex = new Map<string, CallerEntry[]>([
      ['src/a.ts:SearchAdapter.execute', []],
      ['src/a.ts:SearchAdapter.initialize', []],
    ]);

    const nameIndex = buildNameIndex(reverseIndex);

    // Both should be indexed under "SearchAdapter"
    const keys = nameIndex.get('SearchAdapter') ?? [];
    expect(keys).toContain('src/a.ts:SearchAdapter.execute');
    expect(keys).toContain('src/a.ts:SearchAdapter.initialize');
  });

  it('should handle bare name keys', () => {
    const reverseIndex = new Map<string, CallerEntry[]>([['console.log', []]]);

    const nameIndex = buildNameIndex(reverseIndex);

    expect(nameIndex.get('log')).toContain('console.log');
    expect(nameIndex.get('console.log')).toContain('console.log');
  });
});

// ============================================================================
// lookupCallers
// ============================================================================

describe('lookupCallers', () => {
  const reverseIndex = new Map<string, CallerEntry[]>([
    [
      'src/validate.ts:validateArgs',
      [
        { name: 'SearchAdapter.execute', file: 'src/search-adapter.ts', line: 124, type: 'method' },
        { name: 'RefsAdapter.execute', file: 'src/refs-adapter.ts', line: 168, type: 'method' },
      ],
    ],
    [
      'this.searchService.search',
      [{ name: 'SearchAdapter.execute', file: 'src/search-adapter.ts', line: 141, type: 'method' }],
    ],
  ]);

  const nameIndex = buildNameIndex(reverseIndex);

  it('should find callers by compound key', () => {
    const callers = lookupCallers(reverseIndex, nameIndex, 'validateArgs', 'src/validate.ts');
    expect(callers).toHaveLength(2);
  });

  it('should find callers by bare name via nameIndex', () => {
    const callers = lookupCallers(reverseIndex, nameIndex, 'validateArgs', 'unknown-file.ts');
    expect(callers).toHaveLength(2);
  });

  it('should find callers by last segment', () => {
    const callers = lookupCallers(reverseIndex, nameIndex, 'search', 'unknown.ts');
    expect(callers).toHaveLength(1);
    expect(callers[0].name).toBe('SearchAdapter.execute');
  });

  it('should deduplicate by file+name', () => {
    const callers = lookupCallers(reverseIndex, nameIndex, 'validateArgs', 'src/validate.ts');
    const keys = callers.map((c) => `${c.file}:${c.name}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('should respect limit', () => {
    const callers = lookupCallers(reverseIndex, nameIndex, 'validateArgs', 'src/validate.ts', 1);
    expect(callers).toHaveLength(1);
  });

  it('should return empty for unknown name', () => {
    const callers = lookupCallers(reverseIndex, nameIndex, 'nonexistent', 'x.ts');
    expect(callers).toHaveLength(0);
  });
});

// ============================================================================
// lookupClassCallers
// ============================================================================

describe('lookupClassCallers', () => {
  const reverseIndex = new Map<string, CallerEntry[]>([
    [
      'new CompactFormatter',
      [{ name: 'SearchAdapter.execute', file: 'search.ts', line: 154, type: 'method' }],
    ],
    [
      'search.ts:CompactFormatter.formatResults',
      [{ name: 'SearchAdapter.execute', file: 'search.ts', line: 161, type: 'method' }],
    ],
    [
      'other.ts:CompactFormatter.estimateTokens',
      [{ name: 'OtherService.run', file: 'other.ts', line: 20, type: 'method' }],
    ],
  ]);

  const nameIndex = buildNameIndex(reverseIndex);

  it('should aggregate constructor and method callers', () => {
    const callers = lookupClassCallers(reverseIndex, nameIndex, 'CompactFormatter', 'fmt.ts');
    const names = callers.map((c) => c.name);
    expect(names).toContain('SearchAdapter.execute');
    expect(names).toContain('OtherService.run');
  });

  it('should deduplicate across constructor and method callers', () => {
    const callers = lookupClassCallers(reverseIndex, nameIndex, 'CompactFormatter', 'fmt.ts');
    // SearchAdapter.execute appears in both constructor and method — should be deduped
    const keys = callers.map((c) => `${c.file}:${c.name}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('should return empty for unknown class', () => {
    const callers = lookupClassCallers(reverseIndex, nameIndex, 'NonExistent', 'x.ts');
    expect(callers).toHaveLength(0);
  });
});

// ============================================================================
// updateReverseIndexIncremental
// ============================================================================

describe('updateReverseIndexIncremental', () => {
  it('should remove entries from changed files', () => {
    const existing = new Map<string, CallerEntry[]>([
      [
        'src/validate.ts:funcA',
        [
          { name: 'caller1', file: 'old.ts', line: 5, type: 'function' },
          { name: 'caller2', file: 'other.ts', line: 10, type: 'function' },
        ],
      ],
    ]);

    const changedDocs = [mockDoc('old.ts', 'caller1New', 'function', [{ name: 'funcB', line: 5 }])];

    const updated = updateReverseIndexIncremental(existing, changedDocs, []);

    // caller1 from old.ts removed, caller2 stays
    expect(updated.get('src/validate.ts:funcA')).toHaveLength(1);
    expect(updated.get('src/validate.ts:funcA')![0].name).toBe('caller2');
    // new entry for funcB
    expect(updated.get('funcB')).toHaveLength(1);
  });

  it('should remove entries for deleted files', () => {
    const existing = new Map<string, CallerEntry[]>([
      [
        'src/validate.ts:funcA',
        [
          { name: 'caller1', file: 'deleted.ts', line: 5, type: 'function' },
          { name: 'caller2', file: 'kept.ts', line: 10, type: 'function' },
        ],
      ],
    ]);

    const updated = updateReverseIndexIncremental(existing, [], ['deleted.ts']);

    expect(updated.get('src/validate.ts:funcA')).toHaveLength(1);
    expect(updated.get('src/validate.ts:funcA')![0].file).toBe('kept.ts');
  });

  it('should remove compound keys whose file is deleted', () => {
    const existing = new Map<string, CallerEntry[]>([
      ['deleted.ts:funcA', [{ name: 'caller1', file: 'kept.ts', line: 5, type: 'function' }]],
    ]);

    const updated = updateReverseIndexIncremental(existing, [], ['deleted.ts']);

    expect(updated.has('deleted.ts:funcA')).toBe(false);
  });

  it('should not mutate the original map', () => {
    const original = new Map<string, CallerEntry[]>([
      ['a.ts:funcA', [{ name: 'caller1', file: 'old.ts', line: 5, type: 'function' }]],
    ]);
    const originalArray = original.get('a.ts:funcA')!;
    const originalLength = originalArray.length;

    updateReverseIndexIncremental(original, [], ['old.ts']);

    expect(original.get('a.ts:funcA')).toHaveLength(originalLength);
    expect(original.get('a.ts:funcA')).toBe(originalArray);
  });

  it('should clean up empty keys', () => {
    const existing = new Map<string, CallerEntry[]>([
      ['a.ts:funcA', [{ name: 'caller1', file: 'old.ts', line: 5, type: 'function' }]],
    ]);

    const updated = updateReverseIndexIncremental(existing, [], ['old.ts']);

    expect(updated.has('a.ts:funcA')).toBe(false);
  });
});
