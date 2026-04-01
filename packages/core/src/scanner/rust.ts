/**
 * Rust language scanner using tree-sitter
 *
 * Extracts functions, structs, enums, traits, impl methods, imports,
 * callees, and doc comments from Rust source files.
 * Uses tree-sitter queries for declarative pattern matching.
 */

import * as path from 'node:path';
import type { Logger } from '@prosdevlab/kero';
import {
  type FileSystemValidator,
  NodeFileSystemValidator,
  validateFile,
} from '../utils/file-validator';
import { RUST_QUERIES } from './rust-queries';
import type { TreeSitterNode } from './tree-sitter';
import { initTreeSitter, loadLanguage, type ParsedTree, parseCode } from './tree-sitter';
import type { CalleeInfo, Document, Scanner, ScannerCapabilities } from './types';

/** Generated file patterns to skip */
const GENERATED_COMMENTS = ['// Code generated', '// DO NOT EDIT', '// Auto-generated'];

/**
 * Rust scanner using tree-sitter for parsing
 */
export class RustScanner implements Scanner {
  readonly language = 'rust';
  readonly capabilities: ScannerCapabilities = {
    syntax: true,
    types: true,
    documentation: true,
  };

  private static readonly MAX_SNIPPET_LINES = 50;
  private fileValidator: FileSystemValidator;

  constructor(fileValidator: FileSystemValidator = new NodeFileSystemValidator()) {
    this.fileValidator = fileValidator;
  }

  canHandle(filePath: string): boolean {
    return path.extname(filePath).toLowerCase() === '.rs';
  }

  private async validateRustSupport(): Promise<void> {
    try {
      await initTreeSitter();
      await loadLanguage('rust');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('tree-sitter WASM') || errorMessage.includes('Failed to locate')) {
        throw new Error(
          'Rust tree-sitter WASM files not found. ' +
            'tree-sitter-rust.wasm is required for Rust code parsing.'
        );
      }
      throw error;
    }
  }

  async scan(
    files: string[],
    repoRoot: string,
    logger?: Logger,
    onProgress?: (filesProcessed: number, totalFiles: number) => void
  ): Promise<Document[]> {
    const documents: Document[] = [];
    const total = files.length;

    try {
      await this.validateRustSupport();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger?.error({ error: errorMessage }, 'Rust scanner initialization failed');
      throw error;
    }

    const startTime = Date.now();
    let lastLogTime = startTime;

    for (let i = 0; i < total; i++) {
      const file = files[i];

      if (onProgress && i > 0 && i % 50 === 0) {
        onProgress(i, total);
      }

      const now = Date.now();
      if (logger && i > 0 && (i % 50 === 0 || now - lastLogTime > 10000)) {
        lastLogTime = now;
        const percent = Math.round((i / total) * 100);
        logger.info(
          { filesProcessed: i, total, percent, documents: documents.length },
          `rust ${i}/${total} (${percent}%) - ${documents.length} docs`
        );
      }

      try {
        const absolutePath = path.join(repoRoot, file);
        const validation = validateFile(file, absolutePath, this.fileValidator);
        if (!validation.isValid) continue;

        const sourceText = this.fileValidator.readText(absolutePath);

        if (this.isGeneratedFile(file, sourceText)) continue;

        const fileDocs = await this.extractFromFile(sourceText, file);
        documents.push(...fileDocs);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger?.debug({ file, error: errorMessage }, `Skipped Rust file: ${file}`);
      }
    }

    logger?.info(
      { successCount: documents.length, total },
      `Rust scan complete: ${documents.length} docs from ${total} files`
    );

    return documents;
  }

  async extractFromFile(sourceText: string, relativeFile: string): Promise<Document[]> {
    const documents: Document[] = [];

    let tree: ParsedTree;
    try {
      tree = await parseCode(sourceText, 'rust');
    } catch {
      // Parse failure (malformed file) — return empty, don't crash
      return documents;
    }

    // Extract file-level imports
    const imports = this.extractImports(tree);

    // Extract free functions (top-level)
    documents.push(...this.extractFunctions(tree, sourceText, relativeFile, imports));

    // Extract structs
    documents.push(...this.extractStructs(tree, sourceText, relativeFile));

    // Extract enums
    documents.push(...this.extractEnums(tree, sourceText, relativeFile));

    // Extract traits
    documents.push(...this.extractTraits(tree, sourceText, relativeFile));

    // Extract methods from impl blocks
    documents.push(...this.extractMethods(tree, sourceText, relativeFile, imports));

    return documents;
  }

  // ========================================================================
  // Extraction methods
  // ========================================================================

  private extractFunctions(
    tree: ParsedTree,
    sourceText: string,
    file: string,
    imports: string[]
  ): Document[] {
    const documents: Document[] = [];

    for (const match of tree.query(RUST_QUERIES.functions)) {
      const nameCapture = match.captures.find((c) => c.name === 'name');
      const defCapture = match.captures.find((c) => c.name === 'definition');
      if (!nameCapture || !defCapture) continue;

      const name = nameCapture.node.text;
      const node = defCapture.node;
      const startLine = node.startPosition.row + 1;
      const endLine = node.endPosition.row + 1;
      const exported = this.isExported(node);
      const docstring = this.extractDocComment(sourceText, startLine);
      const signature = this.extractSignature(node);
      const snippet = this.truncateSnippet(node.text);
      const callees = this.walkCallNodes(node);
      const isAsync = this.isAsyncFunction(node);

      documents.push({
        id: `${file}:${name}:${startLine}`,
        text: this.buildEmbeddingText('function', name, signature, docstring),
        type: 'function',
        language: 'rust',
        metadata: {
          name,
          file,
          startLine,
          endLine,
          exported,
          signature,
          docstring,
          snippet,
          imports,
          callees: callees.length > 0 ? callees : undefined,
          isAsync: isAsync || undefined,
        },
      });
    }

    return documents;
  }

  private extractStructs(tree: ParsedTree, sourceText: string, file: string): Document[] {
    const documents: Document[] = [];

    for (const match of tree.query(RUST_QUERIES.structs)) {
      const nameCapture = match.captures.find((c) => c.name === 'name');
      const defCapture = match.captures.find((c) => c.name === 'definition');
      if (!nameCapture || !defCapture) continue;

      const name = nameCapture.node.text;
      const node = defCapture.node;
      const startLine = node.startPosition.row + 1;
      const endLine = node.endPosition.row + 1;
      const exported = this.isExported(node);
      const docstring = this.extractDocComment(sourceText, startLine);
      const signature = this.extractSignature(node);

      documents.push({
        id: `${file}:${name}:${startLine}`,
        text: this.buildEmbeddingText('struct', name, signature, docstring),
        type: 'class', // Use 'class' for consistency with TS/Python scanners
        language: 'rust',
        metadata: {
          name,
          file,
          startLine,
          endLine,
          exported,
          signature,
          docstring,
        },
      });
    }

    return documents;
  }

  private extractEnums(tree: ParsedTree, sourceText: string, file: string): Document[] {
    const documents: Document[] = [];

    for (const match of tree.query(RUST_QUERIES.enums)) {
      const nameCapture = match.captures.find((c) => c.name === 'name');
      const defCapture = match.captures.find((c) => c.name === 'definition');
      if (!nameCapture || !defCapture) continue;

      const name = nameCapture.node.text;
      const node = defCapture.node;
      const startLine = node.startPosition.row + 1;
      const endLine = node.endPosition.row + 1;
      const exported = this.isExported(node);
      const docstring = this.extractDocComment(sourceText, startLine);
      const signature = this.extractSignature(node);

      documents.push({
        id: `${file}:${name}:${startLine}`,
        text: this.buildEmbeddingText('enum', name, signature, docstring),
        type: 'class', // Use 'class' for consistency
        language: 'rust',
        metadata: {
          name,
          file,
          startLine,
          endLine,
          exported,
          signature,
          docstring,
        },
      });
    }

    return documents;
  }

  private extractTraits(tree: ParsedTree, sourceText: string, file: string): Document[] {
    const documents: Document[] = [];

    for (const match of tree.query(RUST_QUERIES.traits)) {
      const nameCapture = match.captures.find((c) => c.name === 'name');
      const defCapture = match.captures.find((c) => c.name === 'definition');
      if (!nameCapture || !defCapture) continue;

      const name = nameCapture.node.text;
      const node = defCapture.node;
      const startLine = node.startPosition.row + 1;
      const endLine = node.endPosition.row + 1;
      const exported = this.isExported(node);
      const docstring = this.extractDocComment(sourceText, startLine);
      const signature = this.extractSignature(node);

      documents.push({
        id: `${file}:${name}:${startLine}`,
        text: this.buildEmbeddingText('trait', name, signature, docstring),
        type: 'interface', // Traits map to interfaces
        language: 'rust',
        metadata: {
          name,
          file,
          startLine,
          endLine,
          exported,
          signature,
          docstring,
        },
      });
    }

    return documents;
  }

  private extractMethods(
    tree: ParsedTree,
    sourceText: string,
    file: string,
    imports: string[]
  ): Document[] {
    const documents: Document[] = [];

    for (const match of tree.query(RUST_QUERIES.implMethods)) {
      const receiverCapture = match.captures.find((c) => c.name === 'receiver');
      const nameCapture = match.captures.find((c) => c.name === 'name');
      const defCapture = match.captures.find((c) => c.name === 'definition');
      if (!receiverCapture || !nameCapture || !defCapture) continue;

      // Strip generic type params: Container<T> → Container
      const receiverType = receiverCapture.node.text.replace(/<.*>/, '');
      const methodName = nameCapture.node.text;
      const qualifiedName = `${receiverType}.${methodName}`;
      const node = defCapture.node;
      const startLine = node.startPosition.row + 1;
      const endLine = node.endPosition.row + 1;
      const exported = this.isExported(node);
      const docstring = this.extractDocComment(sourceText, startLine);
      const signature = this.extractSignature(node);
      const snippet = this.truncateSnippet(node.text);
      const callees = this.walkCallNodes(node);
      const isAsync = this.isAsyncFunction(node);

      documents.push({
        id: `${file}:${qualifiedName}:${startLine}`,
        text: this.buildEmbeddingText('method', qualifiedName, signature, docstring),
        type: 'method',
        language: 'rust',
        metadata: {
          name: qualifiedName,
          file,
          startLine,
          endLine,
          exported,
          signature,
          docstring,
          snippet,
          imports,
          callees: callees.length > 0 ? callees : undefined,
          isAsync: isAsync || undefined,
        },
      });
    }

    return documents;
  }

  private extractImports(tree: ParsedTree): string[] {
    const imports: string[] = [];
    for (const match of tree.query(RUST_QUERIES.imports)) {
      const defCapture = match.captures.find((c) => c.name === 'definition');
      if (defCapture) {
        imports.push(defCapture.node.text);
      }
    }
    return imports;
  }

  // ========================================================================
  // Callee extraction
  // ========================================================================

  /**
   * Walk AST nodes recursively to find all call_expression nodes.
   * Skips macro_invocation nodes (println!, vec!, format!, etc.).
   */
  private walkCallNodes(node: TreeSitterNode): CalleeInfo[] {
    const callees: CalleeInfo[] = [];
    const seen = new Set<string>();

    function walk(n: TreeSitterNode) {
      if (n.type === 'call_expression') {
        const funcNode = n.childForFieldName('function');
        if (funcNode) {
          const name = funcNode.text;
          const line = n.startPosition.row + 1;
          const key = `${name}:${line}`;
          if (!seen.has(key)) {
            seen.add(key);
            callees.push({ name, line });
          }
        }
      }
      // Skip macro_invocation entirely — macros (println!, vec!, format!) are not function calls.
      // Without this, calls INSIDE macros (e.g., vec![foo()]) would be captured.
      if (n.type === 'macro_invocation') return;

      for (const child of n.namedChildren) {
        walk(child);
      }
    }

    walk(node);
    return callees;
  }

  // ========================================================================
  // Helpers
  // ========================================================================

  /**
   * Check if a node has a visibility_modifier child (pub, pub(crate), etc.)
   */
  private isExported(node: TreeSitterNode): boolean {
    return node.namedChildren.some((c) => c.type === 'visibility_modifier');
  }

  /**
   * Check if a function is async by looking for 'async' in the function text
   * before the 'fn' keyword. tree-sitter-rust includes 'async' as part of
   * the function_item text.
   */
  private isAsyncFunction(node: TreeSitterNode): boolean {
    // Check the text before 'fn' for the async keyword
    const text = node.text;
    const fnIndex = text.indexOf('fn ');
    if (fnIndex <= 0) return false;
    return text.slice(0, fnIndex).includes('async');
  }

  /**
   * Extract doc comment (/// lines) preceding a node.
   * Walks backwards from the line before the node, collecting /// comments.
   */
  private extractDocComment(sourceText: string, nodeStartLine: number): string | undefined {
    const lines = sourceText.split('\n');
    const docLines: string[] = [];

    // Walk backwards from the line before the node
    for (let i = nodeStartLine - 2; i >= 0; i--) {
      const line = lines[i].trim();

      if (line.startsWith('///')) {
        // Strip /// prefix and trim
        const commentText = line.slice(3).trim();
        docLines.unshift(commentText);
      } else if (line.startsWith('#[')) {
        // Skip attributes (#[derive], #[cfg], etc.) between doc comments and the item
      } else if (line === '') {
        // Empty line — stop if we have comments, otherwise continue
        if (docLines.length > 0) break;
      } else {
        // Non-comment, non-attribute, non-empty — stop
        break;
      }
    }

    return docLines.length > 0 ? docLines.join('\n') : undefined;
  }

  /**
   * Extract the signature line from a node.
   * Skips attribute lines (#[...]) to find the actual fn/struct/enum/trait line.
   */
  private extractSignature(node: TreeSitterNode): string {
    const lines = node.text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (
        trimmed.startsWith('pub ') ||
        trimmed.startsWith('pub(') ||
        trimmed.startsWith('fn ') ||
        trimmed.startsWith('async ') ||
        trimmed.startsWith('struct ') ||
        trimmed.startsWith('enum ') ||
        trimmed.startsWith('trait ') ||
        trimmed.startsWith('type ')
      ) {
        // Return up to the opening brace or end of line
        const braceIndex = trimmed.indexOf('{');
        return braceIndex > 0 ? trimmed.slice(0, braceIndex).trim() : trimmed;
      }
    }
    // Fallback: first line
    return lines[0].trim();
  }

  /**
   * Truncate a code snippet to MAX_SNIPPET_LINES
   */
  private truncateSnippet(text: string): string {
    const lines = text.split('\n');
    if (lines.length <= RustScanner.MAX_SNIPPET_LINES) return text;
    return lines.slice(0, RustScanner.MAX_SNIPPET_LINES).join('\n') + '\n// ...';
  }

  private buildEmbeddingText(
    type: string,
    name: string,
    signature: string,
    docstring?: string
  ): string {
    const parts = [`${type} ${name}`, signature];
    if (docstring) parts.push(docstring);
    return parts.join('\n');
  }

  private isGeneratedFile(filePath: string, sourceText: string): boolean {
    // Skip files in target/ directory (build output)
    if (filePath.includes('/target/') || filePath.startsWith('target/')) return true;

    const firstLines = sourceText.split('\n').slice(0, 3).join('\n');
    return GENERATED_COMMENTS.some((c) => firstLines.includes(c));
  }
}
