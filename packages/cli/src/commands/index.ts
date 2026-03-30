import { join, resolve } from 'node:path';
import {
  AsyncEventBus,
  ensureStorageDirectory,
  getStorageFilePaths,
  getStoragePath,
  type IndexUpdatedEvent,
  MetricsStore,
  RepositoryIndexer,
  updateIndexedStats,
} from '@prosdevlab/dev-agent-core';
import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';
import {
  ensureAntfly,
  hasModel,
  hasNativeBinary,
  isServerReady,
  pullModel,
} from '../utils/antfly.js';
import { getDefaultConfig, loadConfig } from '../utils/config.js';
import { createIndexLogger } from '../utils/logger.js';

const DEFAULT_MODEL = 'BAAI/bge-small-en-v1.5';

export const indexCommand = new Command('index')
  .description('Index a repository (code)')
  .argument('[path]', 'Repository path to index', process.cwd())
  .option('-f, --force', 'Force re-index even if unchanged', false)
  .option('-v, --verbose', 'Verbose output', false)
  .action(async (repositoryPath: string, options) => {
    const spinner = ora();

    try {
      const resolvedRepoPath = resolve(repositoryPath);

      // ── Pre-flight: ensure Antfly is running ──
      if (!(await isServerReady())) {
        spinner.start('Starting Antfly server...');
        try {
          await ensureAntfly({ quiet: true });
          spinner.succeed('Antfly server started');
        } catch {
          spinner.fail('Antfly server is not running');
          console.error('');
          console.error('  This usually means:');
          console.error('    1. Docker/Podman needs more memory (8GB+ recommended)');
          console.error('       → Docker Desktop: Settings → Resources → Memory');
          console.error('       → Podman: podman machine set --memory 8192');
          console.error('    2. First time? Run `dev setup` first');
          console.error('');
          process.exit(1);
        }
      }

      // ── Pre-flight: ensure embedding model is available ──
      if (hasNativeBinary() && !hasModel(DEFAULT_MODEL)) {
        console.log(`  Pulling embedding model: ${DEFAULT_MODEL}`);
        pullModel(DEFAULT_MODEL);
        spinner.succeed(`Embedding model ready: ${DEFAULT_MODEL}`);
      }

      // Load config
      let config = await loadConfig();
      if (!config) {
        config = getDefaultConfig(repositoryPath);
      }

      // Get centralized storage path
      const storagePath = await getStoragePath(resolvedRepoPath);
      await ensureStorageDirectory(storagePath);
      const filePaths = getStorageFilePaths(storagePath);

      // Create event bus for metrics
      const eventBus = new AsyncEventBus();
      const metricsDbPath = join(storagePath, 'metrics.db');
      const metricsStore = new MetricsStore(metricsDbPath);

      eventBus.on<IndexUpdatedEvent>('index.updated', async (event) => {
        try {
          metricsStore.recordSnapshot(event.stats, event.isIncremental ? 'update' : 'index');
        } catch {
          // Metrics are non-critical — don't fail indexing
        }
      });

      const indexer = new RepositoryIndexer(
        {
          repositoryPath: resolvedRepoPath,
          vectorStorePath: filePaths.vectors,
          excludePatterns: config.repository?.excludePatterns || config.excludePatterns,
          languages: config.repository?.languages || config.languages,
        },
        eventBus
      );

      await indexer.initialize();

      const indexLogger = createIndexLogger(options.verbose);

      // Track state for phase transitions
      const startTime = Date.now();
      const scanStartTime = startTime;
      let embeddingStartTime = 0;
      let totalComponents = 0;
      let totalFiles = 0;
      spinner.start('Scanning repository...');

      const stats = await indexer.index({
        force: options.force,
        logger: indexLogger,
        onProgress: (progress) => {
          if (progress.phase === 'scanning') {
            if (progress.totalFiles > 0) {
              spinner.text = `Scanning repository... (${progress.filesProcessed.toLocaleString()}/${progress.totalFiles.toLocaleString()} files)`;
            }
          } else if (
            progress.phase === 'storing' &&
            progress.totalDocuments &&
            !embeddingStartTime
          ) {
            // Transition: scanning → embedding
            totalFiles = progress.filesProcessed;
            totalComponents = progress.totalDocuments;
            const scanDuration = ((Date.now() - scanStartTime) / 1000).toFixed(1);
            spinner.succeed(
              `Scanned ${totalFiles.toLocaleString()} files → ${totalComponents.toLocaleString()} components (${scanDuration}s)`
            );

            embeddingStartTime = Date.now();
            spinner.start(`Embedding ${totalComponents.toLocaleString()} vectors...`);
          }
        },
      });

      // Complete embedding phase
      if (embeddingStartTime) {
        const embeddingDuration = ((Date.now() - embeddingStartTime) / 1000).toFixed(1);
        spinner.succeed(
          `Embedded ${stats.documentsIndexed.toLocaleString()} vectors (${embeddingDuration}s)`
        );
      } else {
        const scanDuration = ((Date.now() - scanStartTime) / 1000).toFixed(1);
        spinner.succeed(
          `Scanned ${stats.filesScanned.toLocaleString()} files → ${stats.documentsIndexed.toLocaleString()} components (${scanDuration}s)`
        );
      }

      // Finalize
      await indexer.close();
      metricsStore.close();

      await updateIndexedStats(storagePath, {
        files: stats.filesScanned,
        components: stats.documentsIndexed,
        size: 0,
      });

      const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);

      console.log(
        `\n  Indexed ${stats.filesScanned.toLocaleString()} files · ${stats.documentsIndexed.toLocaleString()} components in ${totalDuration}s`
      );
      console.log('');
      console.log('  Next steps:');
      console.log('    dev mcp install                Connect to Claude Code');
      console.log('    dev mcp install --cursor       Connect to Cursor');
      console.log('');
      console.log('  Try it out:');
      console.log('    dev search "authentication"    Semantic code search');
      console.log('    dev map                        Explore codebase structure');
      console.log('    dev status                     Check index health');
      console.log('    dev --help                     See all commands');
      console.log('');

      // Show errors if any
      if (stats.errors.length > 0) {
        console.log(
          `  ${chalk.yellow(`${stats.errors.length} error(s) occurred during indexing`)}`
        );
        if (options.verbose) {
          for (const error of stats.errors) {
            console.log(`    ${chalk.gray(error.file)}: ${error.message}`);
          }
        } else {
          console.log(
            `    ${chalk.gray('Run with')} ${chalk.cyan('--verbose')} ${chalk.gray('to see details')}`
          );
        }
        console.log('');
      }
    } catch (error) {
      spinner.fail('Failed to index repository');
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('fetch failed') || message.includes('ECONNREFUSED')) {
        console.error('');
        console.error('  Antfly server is not reachable.');
        console.error('');
        console.error(
          '  If it crashed during indexing, your data is safe — just re-run `dev index`.'
        );
        console.error('  Unchanged documents are skipped automatically.');
        console.error('');
        console.error('  To fix:');
        console.error('    dev setup                      Restart the server');
        console.error('    dev reset && dev setup         Full reset if needed');
        console.error('');
      } else if (message.includes('model not found')) {
        console.error('');
        console.error('  Embedding model is missing. Run `dev setup` to install it.');
        console.error('');
      } else {
        console.error(`\n  ${message}\n`);
      }
      if (options.verbose && error instanceof Error && error.stack) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });
