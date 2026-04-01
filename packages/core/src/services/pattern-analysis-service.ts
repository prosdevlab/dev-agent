/**
 * Pattern Analysis Service
 *
 * Analyzes code patterns in files and compares them against similar files.
 * Provides facts (not judgments) for AI tools to interpret.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  ALL_GO_QUERIES,
  ALL_PYTHON_QUERIES,
  ALL_QUERIES,
  ALL_RUST_QUERIES,
} from '../pattern-matcher/rules';
import type { PatternMatcher, PatternMatchRule } from '../pattern-matcher/wasm-matcher';
import { resolveLanguage } from '../pattern-matcher/wasm-matcher';

/**
 * Language-specific pattern query sets.
 * Map-based selection instead of if/else chain.
 */
const QUERIES_BY_LANGUAGE: Record<string, PatternMatchRule[]> = {
  typescript: ALL_QUERIES,
  tsx: ALL_QUERIES,
  javascript: ALL_QUERIES,
  python: ALL_PYTHON_QUERIES,
  go: ALL_GO_QUERIES,
  rust: ALL_RUST_QUERIES,
};

import { scanRepository } from '../scanner';
import type { Document } from '../scanner/types';
import { findTestFile, isTestFile } from '../utils/test-utils';
import type { SearchResult } from '../vector/types';
import type {
  ErrorHandlingComparison,
  ErrorHandlingPattern,
  FilePatterns,
  FileSizeComparison,
  FileSizePattern,
  ImportStyleComparison,
  ImportStylePattern,
  PatternAnalysisConfig,
  PatternComparison,
  TestingComparison,
  TestingPattern,
  TypeAnnotationComparison,
  TypeAnnotationPattern,
} from './pattern-analysis-types';

// Re-export all types for cleaner imports
export type {
  ErrorHandlingComparison,
  ErrorHandlingPattern,
  FilePatterns,
  FileSizeComparison,
  FileSizePattern,
  ImportStyleComparison,
  ImportStylePattern,
  PatternAnalysisConfig,
  PatternComparison,
  TestingComparison,
  TestingPattern,
  TypeAnnotationComparison,
  TypeAnnotationPattern,
} from './pattern-analysis-types';

// ========================================================================
// Pure Pattern Extractors — no I/O, fully testable
// ========================================================================

/**
 * Extract import style from raw file content.
 */
export function extractImportStyleFromContent(content: string): ImportStylePattern {
  const esmImports = content.match(/^import\s/gm) || [];
  const cjsImports = content.match(/require\s*\(/g) || [];
  const hasESM = esmImports.length > 0;
  const hasCJS = cjsImports.length > 0;

  if (!hasESM && !hasCJS) return { style: 'unknown', importCount: 0 };

  const importCount = esmImports.length + cjsImports.length;
  const style: ImportStylePattern['style'] = hasESM && hasCJS ? 'mixed' : hasESM ? 'esm' : 'cjs';
  return { style, importCount };
}

/**
 * Extract error handling pattern from raw file content.
 */
export function extractErrorHandlingFromContent(content: string): ErrorHandlingPattern {
  const counts = {
    throw: [...content.matchAll(/throw\s+new\s+\w*Error/g)].length,
    result: [...content.matchAll(/Result<|{\s*ok:\s*(true|false)/g)].length,
    errorReturn: [...content.matchAll(/\)\s*:\s*\([^)]*,\s*error\)/g)].length,
  };
  const total = counts.throw + counts.result + counts.errorReturn;
  if (total === 0) return { style: 'unknown', examples: [] };

  const max = Math.max(counts.throw, counts.result, counts.errorReturn);
  const hasMultiple = Object.values(counts).filter((c) => c > 0).length > 1;
  let style: ErrorHandlingPattern['style'] = 'unknown';
  if (hasMultiple) style = 'mixed';
  else if (counts.throw === max) style = 'throw';
  else if (counts.result === max) style = 'result';
  else if (counts.errorReturn === max) style = 'error-return';
  return { style, examples: [] };
}

/**
 * Extract type coverage from function/method signatures.
 */
export function extractTypeCoverageFromSignatures(signatures: string[]): TypeAnnotationPattern {
  if (signatures.length === 0) return { coverage: 'none', annotatedCount: 0, totalCount: 0 };

  const annotated = signatures.filter((sig) => /(\)|=>)\s*:\s*\w+/.test(sig));
  const ratio = annotated.length / signatures.length;
  let coverage: TypeAnnotationPattern['coverage'];
  if (ratio >= 0.9) coverage = 'full';
  else if (ratio >= 0.5) coverage = 'partial';
  else if (ratio > 0) coverage = 'minimal';
  else coverage = 'none';
  return { coverage, annotatedCount: annotated.length, totalCount: signatures.length };
}

// ========================================================================
// AST-Enhanced Extractors — accept pre-computed AST results, regex fallback
// ========================================================================

/**
 * Run all AST queries in a single parse. Call once per file, pass results
 * to each extractor. Avoids parsing the same source 3 times.
 *
 * Returns empty map when matcher or filePath is unavailable (regex fallback).
 */
export async function runAllAstQueries(
  content: string,
  filePath: string | undefined,
  matcher: PatternMatcher | undefined
): Promise<Map<string, number>> {
  if (!matcher || !filePath) return new Map();
  const language = resolveLanguage(filePath);
  if (!language) return new Map();
  const queries = QUERIES_BY_LANGUAGE[language] ?? [];
  if (queries.length === 0) return new Map();
  return matcher.match(content, language, queries);
}

/**
 * Extract error handling using pre-computed AST results + regex fallback.
 */
export function extractErrorHandlingWithAst(
  content: string,
  ast: Map<string, number>
): ErrorHandlingPattern {
  const regex = extractErrorHandlingFromContent(content);

  if (ast.size === 0) return regex;

  const hasThrow = (ast.get('throw') ?? 0) > 0;
  const hasTryCatch = (ast.get('try-catch') ?? 0) > 0;
  const hasPromiseCatch = (ast.get('promise-catch') ?? 0) > 0;
  const hasResultRegex = regex.style === 'result';

  // Classification: throw is the style, try-catch is the mechanism
  if (hasThrow && (hasTryCatch || hasPromiseCatch || hasResultRegex)) {
    return { style: 'mixed', examples: [] };
  }
  if (hasThrow) return { style: 'throw', examples: [] };
  if (hasResultRegex) return regex; // AST can't detect Result<T>, keep regex
  // try-catch or promise.catch alone is a mechanism, not a style —
  // fall through to regex which may have found throw/Result in content
  return regex;
}

/**
 * Extract import style using pre-computed AST results + regex fallback.
 */
export function extractImportStyleWithAst(
  content: string,
  ast: Map<string, number>
): ImportStylePattern {
  const regex = extractImportStyleFromContent(content);

  if (ast.size === 0) return regex;

  const dynamicImports = ast.get('dynamic-import') ?? 0;
  const reExports = ast.get('re-export') ?? 0;
  const requires = ast.get('require') ?? 0;

  // AST affects style classification but not importCount — importCount only adds
  // genuinely new detections (dynamic imports) that regex missed. AST require
  // matches overlap with regex require matches so they don't inflate the count.
  const esmCount =
    (regex.style === 'esm' || regex.style === 'mixed' ? regex.importCount : 0) +
    dynamicImports +
    reExports;
  const cjsCount = requires;

  if (esmCount === 0 && cjsCount === 0) return regex;

  const hasESM = esmCount > 0 || regex.style === 'esm' || regex.style === 'mixed';
  const hasCJS = cjsCount > 0 || regex.style === 'cjs' || regex.style === 'mixed';
  const style: ImportStylePattern['style'] = hasESM && hasCJS ? 'mixed' : hasESM ? 'esm' : 'cjs';
  return { style, importCount: regex.importCount + dynamicImports };
}

/**
 * Extract type coverage using pre-computed AST results + regex signatures.
 */
export function extractTypeCoverageWithAst(
  content: string,
  ast: Map<string, number>,
  signatures?: string[]
): TypeAnnotationPattern {
  const regex = extractTypeCoverageFromSignatures(signatures ?? []);

  if (ast.size === 0) return regex;

  const arrowTyped = ast.get('arrow-return-type') ?? 0;
  const functionTyped = ast.get('function-return-type') ?? 0;
  const arrowTotal = ast.get('arrow-total') ?? 0;
  const functionTotal = ast.get('function-total') ?? 0;
  const astAnnotated = arrowTyped + functionTyped;
  const astTotal = arrowTotal + functionTotal;

  // Merge: use the higher of AST total vs regex total for accurate denominator
  const annotatedCount = Math.max(regex.annotatedCount, astAnnotated);
  const totalCount = Math.max(regex.totalCount, astTotal);

  if (totalCount === 0) return regex;

  const ratio = annotatedCount / totalCount;
  let coverage: TypeAnnotationPattern['coverage'];
  if (ratio >= 0.9) coverage = 'full';
  else if (ratio >= 0.5) coverage = 'partial';
  else if (ratio > 0) coverage = 'minimal';
  else coverage = 'none';

  return { coverage, annotatedCount, totalCount };
}

/**
 * Pattern Analysis Service
 *
 * Extracts and compares code patterns across files.
 */
export class PatternAnalysisService {
  constructor(private config: PatternAnalysisConfig) {}

  /**
   * Analyze patterns in a single file
   *
   * @param filePath - Relative path from repository root
   * @returns Pattern analysis results
   */
  async analyzeFile(filePath: string): Promise<FilePatterns> {
    // Step 1: Scan file to get structured documents
    const result = await scanRepository({
      repoRoot: this.config.repositoryPath,
      include: [filePath],
    });

    const documents = result.documents.filter((d) => d.metadata.file === filePath);

    // Step 2: Use the optimized analysis method
    return this.analyzeFileWithDocs(filePath, documents);
  }

  /**
   * Analyze file patterns using indexed metadata (fast — no ts-morph).
   *
   * Reads signatures from the Antfly index, content from disk (for line count
   * and error handling regex). Falls back gracefully on ENOENT (deleted file).
   */
  async analyzeFileFromIndex(filePath: string, indexedDocs: SearchResult[]): Promise<FilePatterns> {
    const fullPath = path.join(this.config.repositoryPath, filePath);

    let content = '';
    let bytes = 0;
    let lines = 0;
    try {
      const [fileContent, stat] = await Promise.all([
        fs.readFile(fullPath, 'utf-8'),
        fs.stat(fullPath),
      ]);
      content = fileContent;
      bytes = stat.size;
      lines = content.split('\n').length;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      // File deleted between index and analysis — return empty patterns
    }

    const testing = await this.analyzeTesting(filePath);
    const signatures = indexedDocs
      .filter((d) => d.metadata.type === 'function' || d.metadata.type === 'method')
      .map((d) => (d.metadata.signature as string) || '')
      .filter(Boolean);

    // Parse once, run all 12 AST queries, pass results to each extractor
    const ast = await runAllAstQueries(content, filePath, this.config.patternMatcher);

    return {
      fileSize: { lines, bytes },
      testing,
      importStyle: extractImportStyleWithAst(content, ast),
      errorHandling: extractErrorHandlingWithAst(content, ast),
      typeAnnotations: extractTypeCoverageWithAst(content, ast, signatures),
    };
  }

  /**
   * Compare patterns between target file and similar files
   *
   * Uses Antfly index when vectorStorage is available (fast path, ~100ms).
   * Falls back to ts-morph scanning when not (tests, offline).
   */
  async comparePatterns(targetFile: string, similarFiles: string[]): Promise<PatternComparison> {
    const allFiles = [targetFile, ...similarFiles];
    let targetPatterns: FilePatterns;
    let similarPatterns: FilePatterns[];

    if (this.config.vectorStorage) {
      // FAST PATH: read from Antfly index
      // Fast path: index-based analysis (~100ms vs 1-3s)
      const docsByFile = await this.config.vectorStorage.getDocsByFilePath(allFiles);

      targetPatterns = await this.analyzeFileFromIndex(
        targetFile,
        docsByFile.get(targetFile) || []
      );
      similarPatterns = await Promise.all(
        similarFiles.map((f) => this.analyzeFileFromIndex(f, docsByFile.get(f) || []))
      );
    } else {
      // FALLBACK: scan files with ts-morph
      // Fallback: ts-morph scan (for tests/offline)
      const batchResult = await scanRepository({
        repoRoot: this.config.repositoryPath,
        include: allFiles,
      });

      const docsByFile = new Map<string, Document[]>();
      for (const doc of batchResult.documents) {
        const file = doc.metadata.file;
        if (!docsByFile.has(file)) docsByFile.set(file, []);
        docsByFile.get(file)!.push(doc);
      }

      targetPatterns = await this.analyzeFileWithDocs(targetFile, docsByFile.get(targetFile) || []);
      similarPatterns = await Promise.all(
        similarFiles.map((f) => this.analyzeFileWithDocs(f, docsByFile.get(f) || []))
      );
    }

    return {
      fileSize: this.compareFileSize(
        targetPatterns.fileSize,
        similarPatterns.map((s) => s.fileSize)
      ),
      testing: this.compareTesting(
        targetPatterns.testing,
        similarPatterns.map((s) => s.testing)
      ),
      importStyle: this.compareImportStyle(
        targetPatterns.importStyle,
        similarPatterns.map((s) => s.importStyle)
      ),
      errorHandling: this.compareErrorHandling(
        targetPatterns.errorHandling,
        similarPatterns.map((s) => s.errorHandling)
      ),
      typeAnnotations: this.compareTypeAnnotations(
        targetPatterns.typeAnnotations,
        similarPatterns.map((s) => s.typeAnnotations)
      ),
    };
  }

  /**
   * Analyze file patterns using pre-scanned documents (fallback path).
   */
  private async analyzeFileWithDocs(
    filePath: string,
    documents: Document[]
  ): Promise<FilePatterns> {
    const fullPath = path.join(this.config.repositoryPath, filePath);
    const [content, stat, testing] = await Promise.all([
      fs.readFile(fullPath, 'utf-8'),
      fs.stat(fullPath),
      this.analyzeTesting(filePath),
    ]);

    const signatures = documents
      .filter((d) => d.type === 'function' || d.type === 'method')
      .map((d) => d.metadata.signature || '')
      .filter(Boolean);

    // Parse once, run all 12 AST queries, pass results to each extractor
    const ast = await runAllAstQueries(content, filePath, this.config.patternMatcher);

    return {
      fileSize: { lines: content.split('\n').length, bytes: stat.size },
      testing,
      importStyle: extractImportStyleWithAst(content, ast),
      errorHandling: extractErrorHandlingWithAst(content, ast),
      typeAnnotations: extractTypeCoverageWithAst(content, ast, signatures),
    };
  }

  /**
   * Analyze test coverage for a file
   */
  private async analyzeTesting(filePath: string): Promise<TestingPattern> {
    if (isTestFile(filePath)) {
      return { hasTest: false };
    }

    const testFile = await findTestFile(filePath, this.config.repositoryPath);
    return {
      hasTest: testFile !== null,
      testPath: testFile || undefined,
    };
  }

  // ========================================================================
  // Pattern Comparisons
  // ========================================================================

  /**
   * Compare file size against similar files
   */
  private compareFileSize(target: FileSizePattern, similar: FileSizePattern[]): FileSizeComparison {
    if (similar.length === 0) {
      return {
        yourFile: target.lines,
        average: target.lines,
        median: target.lines,
        range: [target.lines, target.lines],
        deviation: 'similar',
      };
    }

    const sizes = similar.map((s) => s.lines).sort((a, b) => a - b);
    const average = sizes.reduce((sum, s) => sum + s, 0) / sizes.length;
    const median = sizes[Math.floor(sizes.length / 2)];
    const range: [number, number] = [sizes[0], sizes[sizes.length - 1]];

    // Determine deviation (>20% difference)
    const avgDiff = Math.abs(target.lines - average) / average;
    let deviation: FileSizeComparison['deviation'];
    if (avgDiff > 0.2) {
      deviation = target.lines > average ? 'larger' : 'smaller';
    } else {
      deviation = 'similar';
    }

    return {
      yourFile: target.lines,
      average: Math.round(average),
      median,
      range,
      deviation,
    };
  }

  /**
   * Compare testing patterns
   */
  private compareTesting(target: TestingPattern, similar: TestingPattern[]): TestingComparison {
    if (similar.length === 0) {
      return {
        yourFile: target.hasTest,
        percentage: target.hasTest ? 100 : 0,
        count: { withTest: target.hasTest ? 1 : 0, total: 1 },
      };
    }

    const withTest = similar.filter((s) => s.hasTest).length;
    const percentage = (withTest / similar.length) * 100;

    return {
      yourFile: target.hasTest,
      percentage: Math.round(percentage),
      count: { withTest, total: similar.length },
    };
  }

  /**
   * Compare import styles
   */
  private compareImportStyle(
    target: ImportStylePattern,
    similar: ImportStylePattern[]
  ): ImportStyleComparison {
    if (similar.length === 0) {
      return {
        yourFile: target.style,
        common: target.style,
        percentage: 100,
        distribution: { [target.style]: 1 },
      };
    }

    // Count distribution
    const distribution: Record<string, number> = {};
    for (const s of similar) {
      distribution[s.style] = (distribution[s.style] || 0) + 1;
    }

    // Find most common
    const common = Object.entries(distribution).reduce((a, b) => (b[1] > a[1] ? b : a))[0];
    const percentage = Math.round((distribution[common] / similar.length) * 100);

    return {
      yourFile: target.style,
      common,
      percentage,
      distribution,
    };
  }

  /**
   * Compare error handling patterns
   */
  private compareErrorHandling(
    target: ErrorHandlingPattern,
    similar: ErrorHandlingPattern[]
  ): ErrorHandlingComparison {
    if (similar.length === 0) {
      return {
        yourFile: target.style,
        common: target.style,
        percentage: 100,
        distribution: { [target.style]: 1 },
      };
    }

    // Count distribution
    const distribution: Record<string, number> = {};
    for (const s of similar) {
      distribution[s.style] = (distribution[s.style] || 0) + 1;
    }

    // Find most common
    const common = Object.entries(distribution).reduce((a, b) => (b[1] > a[1] ? b : a))[0];
    const percentage = Math.round((distribution[common] / similar.length) * 100);

    return {
      yourFile: target.style,
      common,
      percentage,
      distribution,
    };
  }

  /**
   * Compare type annotation patterns
   */
  private compareTypeAnnotations(
    target: TypeAnnotationPattern,
    similar: TypeAnnotationPattern[]
  ): TypeAnnotationComparison {
    if (similar.length === 0) {
      return {
        yourFile: target.coverage,
        common: target.coverage,
        percentage: 100,
        distribution: { [target.coverage]: 1 },
      };
    }

    // Count distribution
    const distribution: Record<string, number> = {};
    for (const s of similar) {
      distribution[s.coverage] = (distribution[s.coverage] || 0) + 1;
    }

    // Find most common
    const common = Object.entries(distribution).reduce((a, b) => (b[1] > a[1] ? b : a))[0];
    const percentage = Math.round((distribution[common] / similar.length) * 100);

    return {
      yourFile: target.coverage,
      common,
      percentage,
      distribution,
    };
  }

  // ========================================================================
  // Utility Methods
  // ========================================================================
}
