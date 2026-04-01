// Export types

export { GoScanner } from './go';
export { MarkdownScanner } from './markdown';
export { PythonScanner } from './python';
export { ScannerRegistry } from './registry';
export { RustScanner } from './rust';
export type {
  CalleeInfo,
  CallerInfo,
  Document,
  DocumentMetadata,
  DocumentType,
  ScanError,
  Scanner,
  ScannerCapabilities,
  ScanOptions,
  ScanProgress,
  ScanResult,
  ScanStats,
} from './types';
// Export scanner implementations
export { TypeScriptScanner } from './typescript';

import { GoScanner } from './go';
import { MarkdownScanner } from './markdown';
import { PythonScanner } from './python';
// Create default scanner registry with TypeScript, Markdown, Go, Python, and Rust
import { ScannerRegistry } from './registry';
import { RustScanner } from './rust';
import type { ScanOptions } from './types';
import { TypeScriptScanner } from './typescript';

/**
 * Create a scanner registry with default scanners
 */
export function createDefaultRegistry(): ScannerRegistry {
  const registry = new ScannerRegistry();

  // Register TypeScript scanner
  registry.register(new TypeScriptScanner());

  // Register Markdown scanner
  registry.register(new MarkdownScanner());

  // Register Go scanner
  registry.register(new GoScanner());

  // Register Python scanner
  registry.register(new PythonScanner());

  // Register Rust scanner
  registry.register(new RustScanner());

  return registry;
}

/**
 * Convenience function to scan a repository with default scanners
 */
export async function scanRepository(options: ScanOptions) {
  const registry = createDefaultRegistry();
  return registry.scanRepository(options);
}
