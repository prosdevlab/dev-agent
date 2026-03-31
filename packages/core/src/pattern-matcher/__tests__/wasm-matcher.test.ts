/**
 * WasmPatternMatcher Tests
 *
 * Tests AST-based pattern detection using real tree-sitter parsing.
 * 10 positive (exact counts), 10 negative (count === 0), 3 routing,
 * 3 edge cases, 1 performance sanity check.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ALL_QUERIES,
  ERROR_HANDLING_QUERIES,
  IMPORT_STYLE_QUERIES,
  TYPE_COVERAGE_QUERIES,
} from '../rules';
import { createPatternMatcher, type PatternMatcher, resolveLanguage } from '../wasm-matcher';

describe('WasmPatternMatcher', () => {
  let matcher: PatternMatcher;

  beforeAll(() => {
    matcher = createPatternMatcher();
  });

  // ========================================================================
  // Positive cases (10 tests — assert exact match counts)
  // ========================================================================

  describe('positive matches (exact counts)', () => {
    it('detects try/catch — count === 1', async () => {
      const results = await matcher.match(
        'try { x(); } catch (e) { }',
        'typescript',
        ERROR_HANDLING_QUERIES
      );
      expect(results.get('try-catch')).toBe(1);
    });

    it('detects throw — count === 1', async () => {
      const results = await matcher.match(
        'throw new Error("bad");',
        'typescript',
        ERROR_HANDLING_QUERIES
      );
      expect(results.get('throw')).toBe(1);
    });

    it('detects promise.catch — count === 1', async () => {
      const results = await matcher.match(
        'fetch("/api").catch(handleError);',
        'typescript',
        ERROR_HANDLING_QUERIES
      );
      expect(results.get('promise-catch')).toBe(1);
    });

    it('detects await-in-try (const declaration) — count === 1', async () => {
      const results = await matcher.match(
        'async function f() { try { const x = await fetch("/api"); } catch (e) {} }',
        'typescript',
        ERROR_HANDLING_QUERIES
      );
      expect(results.get('await-in-try')).toBe(1);
    });

    it('detects error-class with extends — count === 1', async () => {
      const results = await matcher.match(
        'class HttpError extends BaseError { constructor(m: string) { super(m); } }',
        'typescript',
        ERROR_HANDLING_QUERIES
      );
      expect(results.get('error-class')).toBe(1);
    });

    it('detects dynamic import — count === 1', async () => {
      const results = await matcher.match(
        'const m = await import("./mod");',
        'typescript',
        IMPORT_STYLE_QUERIES
      );
      expect(results.get('dynamic-import')).toBe(1);
    });

    it('detects re-export — count === 1', async () => {
      const results = await matcher.match(
        'export { foo } from "./bar";',
        'typescript',
        IMPORT_STYLE_QUERIES
      );
      expect(results.get('re-export')).toBe(1);
    });

    it('detects require — count === 1', async () => {
      const results = await matcher.match(
        'const fs = require("fs");',
        'typescript',
        IMPORT_STYLE_QUERIES
      );
      expect(results.get('require')).toBe(1);
    });

    it('detects arrow function return type — count === 1', async () => {
      const results = await matcher.match(
        'const add = (a: number, b: number): number => a + b;',
        'typescript',
        TYPE_COVERAGE_QUERIES
      );
      expect(results.get('arrow-return-type')).toBe(1);
    });

    it('detects function return type — count === 1', async () => {
      const results = await matcher.match(
        'function greet(name: string): string { return name; }',
        'typescript',
        TYPE_COVERAGE_QUERIES
      );
      expect(results.get('function-return-type')).toBe(1);
    });
  });

  // ========================================================================
  // Negative cases (10 tests — one per query, count === 0)
  // ========================================================================

  describe('negative matches (count === 0)', () => {
    it('no try/catch in source', async () => {
      const results = await matcher.match('const x = 1;', 'typescript', ERROR_HANDLING_QUERIES);
      expect(results.get('try-catch')).toBe(0);
    });

    it('no throw in source', async () => {
      const results = await matcher.match(
        'function safe() { return 1; }',
        'typescript',
        ERROR_HANDLING_QUERIES
      );
      expect(results.get('throw')).toBe(0);
    });

    it('.then() but not .catch()', async () => {
      const results = await matcher.match(
        'fetch("/api").then(handle);',
        'typescript',
        ERROR_HANDLING_QUERIES
      );
      expect(results.get('promise-catch')).toBe(0);
    });

    it('bare await in try — documents narrowness', async () => {
      // await-in-try only matches const/let declarations with await.
      // Bare await as expression statement is intentionally not matched.
      const results = await matcher.match(
        'async function f() { try { await fetch("/api"); } catch (e) {} }',
        'typescript',
        ERROR_HANDLING_QUERIES
      );
      expect(results.get('await-in-try')).toBe(0);
    });

    it('class without extends', async () => {
      const results = await matcher.match(
        'class AppService { run() {} }',
        'typescript',
        ERROR_HANDLING_QUERIES
      );
      expect(results.get('error-class')).toBe(0);
    });

    it('static import only — no dynamic import', async () => {
      const results = await matcher.match(
        'import { foo } from "./bar";',
        'typescript',
        IMPORT_STYLE_QUERIES
      );
      expect(results.get('dynamic-import')).toBe(0);
    });

    it('named export without from — not a re-export', async () => {
      const results = await matcher.match('export { foo };', 'typescript', IMPORT_STYLE_QUERIES);
      expect(results.get('re-export')).toBe(0);
    });

    it('ESM only — no require', async () => {
      const results = await matcher.match(
        'import fs from "fs";',
        'typescript',
        IMPORT_STYLE_QUERIES
      );
      expect(results.get('require')).toBe(0);
    });

    it('arrow without return type', async () => {
      const results = await matcher.match(
        'const add = (a: number, b: number) => a + b;',
        'typescript',
        TYPE_COVERAGE_QUERIES
      );
      expect(results.get('arrow-return-type')).toBe(0);
    });

    it('function without return type', async () => {
      const results = await matcher.match(
        'function greet(name: string) { return name; }',
        'typescript',
        TYPE_COVERAGE_QUERIES
      );
      expect(results.get('function-return-type')).toBe(0);
    });
  });

  // ========================================================================
  // Language routing (3 tests)
  // ========================================================================

  describe('language routing', () => {
    it('parses TSX with try/catch in JSX component', async () => {
      // Use the real fixture file for realistic TSX
      const fixturePath = path.join(__dirname, '../../services/__fixtures__/react-component.tsx');
      let source: string;
      try {
        source = await fs.readFile(fixturePath, 'utf-8');
      } catch {
        // Fixture not available — use inline TSX
        source = `
function App() {
  try { const data = JSON.parse("{}"); } catch (e) { console.error(e); }
  return <div>hello</div>;
}`;
      }

      const results = await matcher.match(source, 'tsx', ERROR_HANDLING_QUERIES);
      expect(results.get('try-catch')).toBeGreaterThan(0);
    });

    it('routes .jsx to javascript grammar', async () => {
      const results = await matcher.match(
        'const App = () => { try { x(); } catch (e) {} return null; };',
        'javascript',
        ERROR_HANDLING_QUERIES
      );
      expect(results.get('try-catch')).toBe(1);
    });

    it('returns empty map for unsupported language', async () => {
      const results = await matcher.match('def hello(): pass', 'python', ERROR_HANDLING_QUERIES);
      expect(results.size).toBe(0);
    });
  });

  // ========================================================================
  // Edge cases (3 tests)
  // ========================================================================

  describe('edge cases', () => {
    it('empty source — no matches, no crash', async () => {
      const results = await matcher.match('', 'typescript', ALL_QUERIES);
      // Empty source returns empty map (short-circuits before parsing)
      expect(results.size).toBe(0);
    });

    it('malformed TypeScript — no crash', async () => {
      const results = await matcher.match(
        'function { { { const = ;; }}',
        'typescript',
        ERROR_HANDLING_QUERIES
      );
      // Parser handles gracefully — may return partial results or empty
      expect(results).toBeInstanceOf(Map);
    });

    it('invalid S-expression — returns 0 for that query', async () => {
      const badRule = [{ id: 'bad', category: 'test', query: '(((invalid_garbage @@@' }];
      const results = await matcher.match('const x = 1;', 'typescript', badRule);
      expect(results.get('bad')).toBe(0);
    });
  });

  // ========================================================================
  // Performance sanity (1 test — soft assertion)
  // ========================================================================

  describe('performance', () => {
    it('parses ~500 lines + 10 queries in reasonable time', async () => {
      // Generate a realistic ~500-line TypeScript file
      const lines: string[] = ['import { foo } from "./bar";', ''];
      for (let i = 0; i < 50; i++) {
        lines.push(`export function fn${i}(x: number): number {`);
        lines.push('  try {');
        lines.push(`    const result = await fetch("/api/${i}");`);
        lines.push('    if (!result.ok) throw new Error("failed");');
        lines.push('    return result.json();');
        lines.push('  } catch (e) {');
        lines.push('    console.error(e);');
        lines.push('    throw e;');
        lines.push('  }');
        lines.push('}');
        lines.push('');
      }
      const source = lines.join('\n');

      const start = Date.now();
      const results = await matcher.match(source, 'typescript', ALL_QUERIES);
      const duration = Date.now() - start;

      // Soft assertion — log timing, generous threshold
      console.log(`Performance: ${source.split('\n').length} lines, 10 queries, ${duration}ms`);
      expect(duration).toBeLessThan(500);

      // Sanity: should find patterns in the generated code
      expect(results.get('try-catch')).toBeGreaterThan(0);
      expect(results.get('throw')).toBeGreaterThan(0);
      expect(results.get('function-return-type')).toBeGreaterThan(0);
    });
  });
});

// ========================================================================
// resolveLanguage (extension routing)
// ========================================================================

describe('resolveLanguage', () => {
  it('maps .ts to typescript', () => {
    expect(resolveLanguage('src/auth.ts')).toBe('typescript');
  });

  it('maps .tsx to tsx', () => {
    expect(resolveLanguage('components/App.tsx')).toBe('tsx');
  });

  it('maps .js to javascript', () => {
    expect(resolveLanguage('lib/utils.js')).toBe('javascript');
  });

  it('maps .jsx to javascript', () => {
    expect(resolveLanguage('components/App.jsx')).toBe('javascript');
  });

  it('returns undefined for unsupported extensions', () => {
    expect(resolveLanguage('main.py')).toBeUndefined();
    expect(resolveLanguage('main.go')).toBeUndefined(); // Go has scanner, not pattern matcher
    expect(resolveLanguage('README.md')).toBeUndefined();
  });
});
