/**
 * File Watcher — @parcel/watcher wrapper with debounce and serial flush.
 *
 * Self-contained module with no MCP-specific imports. Provides:
 * - `startFileWatcher()` — live subscription with debounced onChanges
 * - `getEventsSince()` — startup catchup from stored snapshot
 * - `writeSnapshot()` — persist watcher state for restart recovery
 */

import * as fs from 'node:fs/promises';
import * as watcher from '@parcel/watcher';

// ── Default ignore patterns ─────────────────────────────────────────────

const DEFAULT_IGNORE: string[] = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/__pycache__/**',
  '**/*.pyc',
  '**/.DS_Store',
  '**/coverage/**',
  '**/.turbo/**',
];

// ── Types ────────────────────────────────────────────────────────────────

export interface FileWatcherConfig {
  repositoryPath: string;
  snapshotPath: string;
  onChanges: (changed: string[], deleted: string[]) => Promise<void>;
  onError?: (error: unknown) => void;
  debounceMs?: number;
  ignorePatterns?: string[];
}

export interface FileWatcherHandle {
  unsubscribe(): Promise<void>;
  writeSnapshot(): Promise<void>;
}

export interface CatchupResult {
  changed: string[];
  deleted: string[];
  snapshotMissing: boolean;
}

// ── startFileWatcher ─────────────────────────────────────────────────────

export async function startFileWatcher(config: FileWatcherConfig): Promise<FileWatcherHandle> {
  const debounceMs = config.debounceMs ?? 500;
  const ignorePatterns = [...DEFAULT_IGNORE, ...(config.ignorePatterns ?? [])];

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  const pending = { changed: new Set<string>(), deleted: new Set<string>() };
  let flushChain = Promise.resolve();

  const doFlush = async () => {
    const changed = [...pending.changed];
    const deleted = [...pending.deleted];
    pending.changed.clear();
    pending.deleted.clear();
    if (changed.length > 0 || deleted.length > 0) {
      await config.onChanges(changed, deleted);
    }
  };

  const flush = () => {
    flushChain = flushChain.then(doFlush).catch((err) => {
      config.onError?.(err);
    });
  };

  const subscription = await watcher.subscribe(
    config.repositoryPath,
    (err, events) => {
      if (err) {
        config.onError?.(err);
        return;
      }
      for (const event of events) {
        if (event.type === 'delete') {
          pending.deleted.add(event.path);
          pending.changed.delete(event.path);
        } else {
          // 'create' or 'update'
          pending.changed.add(event.path);
          pending.deleted.delete(event.path);
        }
      }
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(flush, debounceMs);
    },
    { ignore: ignorePatterns }
  );

  return {
    async unsubscribe() {
      clearTimeout(debounceTimer);
      await subscription.unsubscribe();
    },
    async writeSnapshot() {
      await watcher.writeSnapshot(config.repositoryPath, config.snapshotPath);
    },
  };
}

// ── getEventsSince ───────────────────────────────────────────────────────

export async function getEventsSince(
  repositoryPath: string,
  snapshotPath: string,
  ignorePatterns: string[] = []
): Promise<CatchupResult> {
  // Check if snapshot exists
  try {
    await fs.access(snapshotPath);
  } catch {
    return { changed: [], deleted: [], snapshotMissing: true };
  }

  // Load events since snapshot
  try {
    const events = await watcher.getEventsSince(repositoryPath, snapshotPath, {
      ignore: [...DEFAULT_IGNORE, ...ignorePatterns],
    });

    const changed: string[] = [];
    const deleted: string[] = [];

    for (const event of events) {
      if (event.type === 'delete') {
        deleted.push(event.path);
      } else {
        changed.push(event.path);
      }
    }

    return { changed, deleted, snapshotMissing: false };
  } catch {
    // Corrupted snapshot — treat as missing
    return { changed: [], deleted: [], snapshotMissing: true };
  }
}
