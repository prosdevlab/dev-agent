#!/usr/bin/env node
/**
 * dev-agent MCP Server Entry Point
 * Starts the MCP server with stdio transport for AI tools (Claude, Cursor, etc.)
 */

import {
  createPatternMatcher,
  ensureStorageDirectory,
  getStorageFilePaths,
  getStoragePath,
  RepositoryIndexer,
  SearchService,
  saveMetadata,
} from '@prosdevlab/dev-agent-core';
import {
  InspectAdapter,
  MapAdapter,
  RefsAdapter,
  SearchAdapter,
  StatusAdapter,
} from '../src/adapters/built-in';
import { MCPServer } from '../src/server/mcp-server';
import type { FileWatcherHandle } from '../src/watcher';
import { createIncrementalIndexer, getEventsSince, startFileWatcher } from '../src/watcher';

// Get config from environment with smart workspace detection
// Priority: WORKSPACE_FOLDER_PATHS (Cursor dynamic) > REPOSITORY_PATH (explicit) > cwd (fallback)
const repositoryPath =
  process.env.WORKSPACE_FOLDER_PATHS || process.env.REPOSITORY_PATH || process.cwd();
const logLevel = (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info';

console.error('[MCP] Workspace detection:', {
  detected: repositoryPath,
  source: process.env.WORKSPACE_FOLDER_PATHS
    ? 'WORKSPACE_FOLDER_PATHS'
    : process.env.REPOSITORY_PATH
      ? 'REPOSITORY_PATH'
      : 'cwd',
});

// Lazy-loaded indexer
let indexer: RepositoryIndexer | undefined;
let lastAccessed = Date.now();
const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

/**
 * Ensure indexer is loaded (lazy loading)
 * This will be called on first tool use
 */
async function _ensureIndexer(): Promise<RepositoryIndexer> {
  if (!indexer) {
    // Get centralized storage path
    const storagePath = await getStoragePath(repositoryPath);
    await ensureStorageDirectory(storagePath);
    const filePaths = getStorageFilePaths(storagePath);

    // Initialize repository indexer with centralized storage
    indexer = new RepositoryIndexer({
      repositoryPath,
      vectorStorePath: filePaths.vectors,
    });

    await indexer.initialize();

    // Update metadata
    await saveMetadata(storagePath, repositoryPath);

    console.error(`[MCP] Loaded indexes from ${storagePath}`);
  }

  lastAccessed = Date.now();
  return indexer;
}

/**
 * Auto-unload indexer after idle period
 * TODO: Enable idle monitoring in future iteration
 */
function _startIdleMonitor(): void {
  setInterval(() => {
    const idleTime = Date.now() - lastAccessed;

    if (idleTime > IDLE_TIMEOUT && indexer) {
      indexer
        .close()
        .then(() => {
          indexer = undefined;
          const idleMinutes = Math.floor(idleTime / 60000);
          console.error(`[MCP] Unloaded indexes (idle timeout: ${idleMinutes} minutes)`);
        })
        .catch((error) => {
          console.error('[MCP] Error unloading indexes:', error);
        });
    }
  }, 60000); // Check every minute
}

/**
 * Startup catchup: process file changes that occurred while the server was off.
 * - No snapshot: run full index, write snapshot
 * - Snapshot with no changes: log "index is current"
 * - Snapshot with changes: run incremental update, write snapshot
 */
async function startupCatchup(
  indexer: RepositoryIndexer,
  repositoryPath: string,
  snapshotPath: string
): Promise<void> {
  const result = await getEventsSince(repositoryPath, snapshotPath);

  if (result.snapshotMissing) {
    console.error('[MCP] No watcher snapshot found — running full index');
    const stats = await indexer.index();
    console.error(`[MCP] Full index complete: ${stats.documentsIndexed} docs`);
    const watcher = await import('@parcel/watcher');
    await watcher.writeSnapshot(repositoryPath, snapshotPath);
    return;
  }

  const { changed, deleted } = result;

  if (changed.length === 0 && deleted.length === 0) {
    console.error('[MCP] No changes since last run — index is current');
    return;
  }

  console.error(`[MCP] Catching up: ${changed.length} changed, ${deleted.length} deleted`);

  const incrementalIndexer = createIncrementalIndexer({
    repositoryIndexer: indexer,
    repositoryPath,
    logger: {
      info: console.error.bind(console),
      warn: console.error.bind(console),
      error: console.error.bind(console),
    },
  });
  await incrementalIndexer.onChanges(changed, deleted);
  console.error('[MCP] Catchup complete');

  const watcher = await import('@parcel/watcher');
  await watcher.writeSnapshot(repositoryPath, snapshotPath);
}

/**
 * Check if Antfly server is reachable.
 */
async function isAntflyReady(): Promise<boolean> {
  const url = process.env.ANTFLY_URL ?? 'http://localhost:18080/api/v1';
  const baseUrl = url.replace('/api/v1', '');
  try {
    const resp = await fetch(`${baseUrl}/api/v1/tables`, { signal: AbortSignal.timeout(3000) });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Try to start Antfly if not running (native first, then Docker).
 */
async function tryStartAntfly(): Promise<void> {
  const { execSync, spawn } = await import('node:child_process');

  // Try native
  try {
    execSync('antfly --version', { stdio: 'pipe', timeout: 5000 });
    const child = spawn(
      'antfly',
      [
        'swarm',
        '--metadata-api',
        'http://0.0.0.0:18080',
        '--store-api',
        'http://0.0.0.0:18381',
        '--metadata-raft',
        'http://0.0.0.0:19017',
        '--store-raft',
        'http://0.0.0.0:19021',
        '--health-port',
        '14200',
      ],
      { detached: true, stdio: 'ignore' }
    );
    child.unref();
    console.error('[MCP] Starting Antfly server (native)...');

    // Wait for ready
    const start = Date.now();
    while (Date.now() - start < 30_000) {
      if (await isAntflyReady()) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('Antfly did not start in 30s');
  } catch {
    // Try Docker
    try {
      execSync('docker info', { stdio: 'pipe', timeout: 5000 });
      try {
        execSync('docker start dev-agent-antfly', { stdio: 'pipe' });
      } catch {
        execSync(
          'docker run -d --name dev-agent-antfly -p 18080:8080 -m 8g --platform linux/amd64 ghcr.io/antflydb/antfly:latest swarm',
          { stdio: 'pipe' }
        );
      }
      console.error('[MCP] Starting Antfly server (Docker)...');

      const start = Date.now();
      while (Date.now() - start < 30_000) {
        if (await isAntflyReady()) return;
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error('Antfly did not start in 30s');
    } catch {
      // Neither available — will fail at indexer.initialize()
    }
  }
}

async function main() {
  let watcherHandle: FileWatcherHandle | undefined;

  try {
    // Ensure Antfly is running before initializing
    if (!(await isAntflyReady())) {
      await tryStartAntfly();
    }

    // Get centralized storage paths
    const storagePath = await getStoragePath(repositoryPath);
    await ensureStorageDirectory(storagePath);
    const filePaths = getStorageFilePaths(storagePath);

    // Initialize repository indexer with centralized storage
    const indexer = new RepositoryIndexer({
      repositoryPath,
      vectorStorePath: filePaths.vectors,
    });

    await indexer.initialize();

    // Update metadata
    await saveMetadata(storagePath, repositoryPath);

    // Startup catchup: index or update since last snapshot
    await startupCatchup(indexer, repositoryPath, filePaths.watcherSnapshot);

    // Create services
    const searchService = new SearchService({ repositoryPath });

    // Create and register adapters
    const searchAdapter = new SearchAdapter({
      searchService,
      repositoryPath,
      defaultFormat: 'compact',
      defaultLimit: 10,
    });

    const statusAdapter = new StatusAdapter({
      vectorStorage: indexer.getVectorStorage(),
      repositoryPath,
      watcherSnapshotPath: filePaths.watcherSnapshot,
      defaultSection: 'summary',
    });

    const inspectAdapter = new InspectAdapter({
      repositoryPath,
      searchService,
      vectorStorage: indexer.getVectorStorage(),
      patternMatcher: createPatternMatcher(),
      defaultLimit: 10,
      defaultThreshold: 0.7,
      defaultFormat: 'compact',
    });

    const refsAdapter = new RefsAdapter({
      searchService,
      indexer,
      defaultLimit: 20,
    });

    const mapAdapter = new MapAdapter({
      repositoryIndexer: indexer,
      repositoryPath,
      defaultDepth: 2,
      defaultTokenBudget: 2000,
    });

    // Create MCP server with 5 adapters (health merged into status)
    const server = new MCPServer({
      serverInfo: {
        name: 'dev-agent',
        version: '0.1.0',
      },
      config: {
        repositoryPath,
        logLevel,
      },
      transport: 'stdio',
      adapters: [searchAdapter, statusAdapter, inspectAdapter, refsAdapter, mapAdapter],
    });

    // Start server
    await server.start();

    // Start file watcher for automatic incremental re-indexing
    const incrementalIndexer = createIncrementalIndexer({
      repositoryIndexer: indexer,
      repositoryPath,
      logger: {
        info: console.error.bind(console),
        warn: console.error.bind(console),
        error: console.error.bind(console),
      },
    });

    watcherHandle = await startFileWatcher({
      repositoryPath,
      snapshotPath: filePaths.watcherSnapshot,
      onChanges: async (changed, deleted) => {
        await incrementalIndexer.onChanges(changed, deleted);
        // Write snapshot after each successful incremental update
        await watcherHandle?.writeSnapshot();
      },
      onError: (err) => {
        console.error('[MCP] File watcher error:', err);
      },
    });

    console.error('[MCP] File watcher started');

    // Handle graceful shutdown
    const shutdown = async () => {
      if (watcherHandle) {
        await watcherHandle.unsubscribe().catch(() => {});
      }
      await server.stop();
      await indexer.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Keep process alive (server runs until stdin closes or signal received)
  } catch (error) {
    if (watcherHandle) {
      await watcherHandle.unsubscribe().catch(() => {});
    }
    console.error('Failed to start MCP server:', error);
    process.exit(1);
  }
}

main();
