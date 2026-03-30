/**
 * Change Frequency Tracker
 *
 * Calculates git commit frequency for files and packages to show
 * which parts of the codebase change most often.
 */

import { execSync } from 'node:child_process';

/**
 * File change frequency data
 */
export interface FileChangeFrequency {
  /** File path relative to repository root */
  filePath: string;

  /** Total commits touching this file */
  commitCount: number;

  /** Last modification timestamp */
  lastModified: Date;

  /** Number of authors who modified this file */
  authorCount: number;
}

/**
 * Options for calculating change frequency
 */
export interface ChangeFrequencyOptions {
  /** Repository path */
  repositoryPath: string;

  /** Only count commits since this date */
  since?: Date;

  /** Maximum number of commits to analyze (default: 1000) */
  maxCommits?: number;
}

/** Parsed commit entry from git log output */
export interface ParsedCommitEntry {
  author: string;
  date: Date;
  file: string;
}

/**
 * Parse git log output into structured commit entries.
 * Pure function — no I/O.
 *
 * Input format (from `git log --pretty=format:%H %ae %ai --name-only`):
 *   <hash> <email> <date>
 *   <file1>
 *   <file2>
 *   <empty line>
 *   <hash> <email> <date>
 *   ...
 */
export function parseGitLogOutput(output: string): ParsedCommitEntry[] {
  const entries: ParsedCommitEntry[] = [];
  let currentAuthor = '';
  let currentDate = new Date();

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const commitMatch = trimmed.match(/^[0-9a-f]{40}\s+(\S+)\s+(.+)$/);
    if (commitMatch) {
      currentAuthor = commitMatch[1];
      currentDate = new Date(commitMatch[2]);
      continue;
    }

    entries.push({ author: currentAuthor, date: currentDate, file: trimmed });
  }

  return entries;
}

/**
 * Build frequency map from parsed commit entries.
 * Pure function — no I/O.
 */
export function buildFrequencyMap(entries: ParsedCommitEntry[]): Map<string, FileChangeFrequency> {
  const frequencies = new Map<string, FileChangeFrequency>();
  const authorSets = new Map<string, Set<string>>();

  for (const entry of entries) {
    const existing = frequencies.get(entry.file);
    if (existing) {
      existing.commitCount++;
      if (entry.date > existing.lastModified) {
        existing.lastModified = entry.date;
      }
      authorSets.get(entry.file)!.add(entry.author);
    } else {
      const authors = new Set<string>();
      authors.add(entry.author);
      authorSets.set(entry.file, authors);
      frequencies.set(entry.file, {
        filePath: entry.file,
        commitCount: 1,
        lastModified: entry.date,
        authorCount: 1,
      });
    }
  }

  // Finalize author counts
  for (const [filePath, freq] of frequencies) {
    const authors = authorSets.get(filePath);
    if (authors) {
      freq.authorCount = authors.size;
    }
  }

  return frequencies;
}

/**
 * Calculate change frequency for all tracked files in a repository.
 * Uses a single git log call — no per-file queries.
 */
export async function calculateChangeFrequency(
  options: ChangeFrequencyOptions
): Promise<Map<string, FileChangeFrequency>> {
  const { repositoryPath, since, maxCommits = 1000 } = options;

  try {
    const args = [
      'log',
      `--max-count=${maxCommits}`,
      '--pretty=format:%H %ae %ai',
      '--name-only',
      '--diff-filter=AMCR',
    ];

    if (since) {
      args.push(`--since="${since.toISOString()}"`);
    }

    const output = execSync(`git ${args.join(' ')}`, {
      cwd: repositoryPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });

    const entries = parseGitLogOutput(output);
    return buildFrequencyMap(entries);
  } catch {
    return new Map();
  }
}

/**
 * Strip a focus prefix from a file path.
 * Pure function — used by map to root the tree at the focused directory.
 */
export function stripFocusPrefix(filePath: string, focus: string): string {
  if (!focus) return filePath;
  if (filePath.startsWith(`${focus}/`)) return filePath.slice(focus.length + 1);
  if (filePath.startsWith(focus)) return filePath.slice(focus.length);
  return filePath;
}

/**
 * Calculate aggregate stats from file frequencies
 */
export function aggregateChangeFrequency(
  frequencies: Map<string, FileChangeFrequency>,
  filterPath?: string
): {
  totalCommits: number;
  avgCommitsPerFile: number;
  lastModified: Date | null;
} {
  let totalCommits = 0;
  let fileCount = 0;
  let mostRecent: Date | null = null;

  for (const [filePath, frequency] of frequencies) {
    if (filterPath && !filePath.startsWith(filterPath)) {
      continue;
    }

    totalCommits += frequency.commitCount;
    fileCount++;

    if (!mostRecent || frequency.lastModified > mostRecent) {
      mostRecent = frequency.lastModified;
    }
  }

  return {
    totalCommits,
    avgCommitsPerFile: fileCount > 0 ? totalCommits / fileCount : 0,
    lastModified: mostRecent,
  };
}
