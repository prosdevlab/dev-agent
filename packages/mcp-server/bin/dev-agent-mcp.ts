#!/usr/bin/env node
/**
 * dev-agent MCP Server Entry Point
 * Starts the MCP server with stdio transport for AI tools (Claude, Cursor, etc.)
 */

import {
  ensureStorageDirectory,
  getStorageFilePaths,
  getStoragePath,
  RepositoryIndexer,
  SearchService,
  StatsService,
  saveMetadata,
} from '@prosdevlab/dev-agent-core';
import {
  HealthAdapter,
  InspectAdapter,
  MapAdapter,
  RefsAdapter,
  SearchAdapter,
  StatusAdapter,
} from '../src/adapters/built-in';
import { MCPServer } from '../src/server/mcp-server';

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

async function main() {
  try {
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

    // Create services
    const searchService = new SearchService({ repositoryPath });
    const statsService = new StatsService({ repositoryPath });

    // Create and register adapters
    const searchAdapter = new SearchAdapter({
      searchService,
      repositoryPath,
      defaultFormat: 'compact',
      defaultLimit: 10,
    });

    const statusAdapter = new StatusAdapter({
      statsService,
      repositoryPath,
      vectorStorePath: filePaths.vectors,
      defaultSection: 'summary',
    });

    const inspectAdapter = new InspectAdapter({
      repositoryPath,
      searchService,
      defaultLimit: 10,
      defaultThreshold: 0.7,
      defaultFormat: 'compact',
    });

    const healthAdapter = new HealthAdapter({
      repositoryPath,
      vectorStorePath: filePaths.vectors,
    });

    const refsAdapter = new RefsAdapter({
      searchService,
      defaultLimit: 20,
    });

    const mapAdapter = new MapAdapter({
      repositoryIndexer: indexer,
      repositoryPath,
      defaultDepth: 2,
      defaultTokenBudget: 2000,
    });

    // Create MCP server with 6 adapters
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
      adapters: [
        searchAdapter,
        statusAdapter,
        inspectAdapter,
        healthAdapter,
        refsAdapter,
        mapAdapter,
      ],
    });

    // Handle graceful shutdown
    const shutdown = async () => {
      await server.stop();
      await indexer.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Start server
    await server.start();

    // Keep process alive (server runs until stdin closes or signal received)
  } catch (error) {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
  }
}

main();
