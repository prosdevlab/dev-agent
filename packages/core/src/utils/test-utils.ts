/**
 * Test utilities for file and pattern analysis
 *
 * Provides helpers for detecting and locating test files.
 * Language-aware: supports JS/TS, Go, and Python test conventions.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Language-specific test file detection patterns.
 * Extensible: add new languages by adding entries to this map.
 */
const TEST_PATTERNS: Record<string, (filePath: string) => boolean> = {
  ts: (f) => f.includes('.test.') || f.includes('.spec.'),
  tsx: (f) => f.includes('.test.') || f.includes('.spec.'),
  js: (f) => f.includes('.test.') || f.includes('.spec.'),
  jsx: (f) => f.includes('.test.') || f.includes('.spec.'),
  go: (f) => f.endsWith('_test.go'),
  // Python conventions are name-based (test_*.py), so we check basename not full path
  py: (f) => {
    const name = path.basename(f);
    return name.startsWith('test_') || name.endsWith('_test.py') || name === 'conftest.py';
  },
};

/**
 * Check if a file path is a test file.
 * Uses language-specific patterns based on file extension.
 */
export function isTestFile(filePath: string): boolean {
  const ext = path.extname(filePath).slice(1); // 'ts', 'py', etc.
  const check = TEST_PATTERNS[ext];
  if (check) return check(filePath);
  // Fallback for unknown extensions: JS/TS convention
  return filePath.includes('.test.') || filePath.includes('.spec.');
}

/**
 * Language-specific test file path generators.
 */
const TEST_PATH_GENERATORS: Record<string, (base: string, ext: string) => string[]> = {
  py: (base, _ext) => {
    const dir = path.dirname(base);
    const name = path.basename(base);
    return [path.join(dir, `test_${name}.py`), path.join(dir, `${name}_test.py`)];
  },
};

/**
 * Find test file for a source file.
 * Checks for language-specific test patterns.
 */
export async function findTestFile(
  sourcePath: string,
  repositoryPath: string
): Promise<string | null> {
  const ext = path.extname(sourcePath);
  const base = sourcePath.slice(0, -ext.length);
  const extKey = ext.slice(1); // 'ts', 'py', etc.

  // Language-specific patterns
  const generator = TEST_PATH_GENERATORS[extKey];
  const patterns = generator ? generator(base, ext) : [`${base}.test${ext}`, `${base}.spec${ext}`];

  for (const testPath of patterns) {
    const fullPath = path.join(repositoryPath, testPath);
    try {
      await fs.access(fullPath);
      return testPath;
    } catch {
      // File doesn't exist, try next pattern
    }
  }

  return null;
}
