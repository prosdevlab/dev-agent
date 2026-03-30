import { existsSync } from 'node:fs';
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
import { getDefaultConfig, loadConfig } from '../utils/config.js';
// Storage size calculation moved to on-demand in `dev stats` command
import { createIndexLogger, logger } from '../utils/logger.js';
import { output } from '../utils/output.js';
import { formatFinalSummary, ProgressRenderer } from '../utils/progress.js';

/**
 * Check if directory is a git repository
 */
function isGitRepository(path: string): boolean {
  return existsSync(join(path, '.git'));
}

export const indexCommand = new Command('index')
  .description('Index a repository (code)')
  .argument('[path]', 'Repository path to index', process.cwd())
  .option('-f, --force', 'Force re-index even if unchanged', false)
  .option('-v, --verbose', 'Verbose output', false)
  .action(async (repositoryPath: string, options) => {
    const spinner = ora('Checking prerequisites...').start();

    try {
      const resolvedRepoPath = resolve(repositoryPath);

      // Check prerequisites upfront
      const isGitRepo = isGitRepository(resolvedRepoPath);

      // Show what will be indexed (clean output without timestamps)
      spinner.stop();
      console.log('');
      console.log(chalk.bold('Indexing Plan:'));
      console.log(`  ${chalk.green('✓')} Code (always)`);
      if (isGitRepo) {
        console.log(`  ${chalk.gray('○')} Git history (use git CLI directly)`);
      }
      console.log('');

      spinner.start('Loading configuration...');

      // Load config or use defaults
      let config = await loadConfig();
      if (!config) {
        spinner.info('No config found, using defaults');
        config = getDefaultConfig(repositoryPath);
      }

      // Get centralized storage path
      spinner.text = 'Resolving storage path...';
      const storagePath = await getStoragePath(resolvedRepoPath);
      await ensureStorageDirectory(storagePath);
      const filePaths = getStorageFilePaths(storagePath);

      spinner.text = 'Initializing indexer...';

      // Create event bus for metrics (no logger in CLI to keep it simple)
      const eventBus = new AsyncEventBus();

      // Initialize metrics store (no logger in CLI to avoid noise)
      const metricsDbPath = join(storagePath, 'metrics.db');
      const metricsStore = new MetricsStore(metricsDbPath);

      // Subscribe to index.updated events for automatic metrics persistence
      eventBus.on<IndexUpdatedEvent>('index.updated', async (event) => {
        try {
          const snapshotId = metricsStore.recordSnapshot(
            event.stats,
            event.isIncremental ? 'update' : 'index'
          );

          // Store code metadata if available
          if (event.codeMetadata && event.codeMetadata.length > 0) {
            metricsStore.appendCodeMetadata(snapshotId, event.codeMetadata);
          }
        } catch (error) {
          // Log error but don't fail indexing - metrics are non-critical
          logger.error(
            `Failed to record metrics: ${error instanceof Error ? error.message : String(error)}`
          );
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

      // Create logger for indexing (verbose mode shows debug logs)
      const indexLogger = createIndexLogger(options.verbose);

      // Stop spinner and switch to section-based progress (unless verbose)
      spinner.stop();

      // Initialize progress renderer
      const progressRenderer = new ProgressRenderer({ verbose: options.verbose });
      const sections: string[] = ['Scanning Repository', 'Embedding Vectors'];
      progressRenderer.setSections(sections);

      const startTime = Date.now();
      const scanStartTime = startTime;
      let embeddingStartTime = 0;
      let inEmbeddingPhase = false;

      const stats = await indexer.index({
        force: options.force,
        logger: indexLogger,
        onProgress: (progress) => {
          if (progress.phase === 'storing' && progress.totalDocuments) {
            // Transitioning to embedding phase
            if (!inEmbeddingPhase) {
              // Complete scanning section and move to embedding
              const scanDuration = (Date.now() - scanStartTime) / 1000;
              progressRenderer.completeSection(
                `${progress.totalDocuments.toLocaleString()} components extracted`,
                scanDuration
              );
              embeddingStartTime = Date.now();
              inEmbeddingPhase = true;
            }

            // Update embedding progress
            progressRenderer.updateSectionWithRate(
              progress.documentsIndexed,
              progress.totalDocuments,
              'documents',
              embeddingStartTime
            );
          } else if (progress.phase === 'scanning') {
            // Scanning phase - show file progress
            progressRenderer.updateSectionWithRate(
              progress.filesProcessed,
              progress.totalFiles,
              'files',
              scanStartTime
            );
          }
        },
      });

      // Complete embedding section
      if (inEmbeddingPhase) {
        const embeddingDuration = (Date.now() - embeddingStartTime) / 1000;
        progressRenderer.completeSection(
          `${stats.documentsIndexed.toLocaleString()} documents`,
          embeddingDuration
        );
      } else {
        // If we never entered embedding phase (edge case), complete scanning
        const scanDuration = (Date.now() - scanStartTime) / 1000;
        progressRenderer.completeSection(
          `${stats.filesScanned.toLocaleString()} files → ${stats.documentsIndexed.toLocaleString()} components`,
          scanDuration
        );
      }

      // Finalize indexing (silent - no UI update needed)
      await indexer.close();
      metricsStore.close();

      // Update metadata with indexing stats (storage size calculated on-demand)
      await updateIndexedStats(storagePath, {
        files: stats.filesScanned,
        components: stats.documentsIndexed,
        size: 0, // Calculated on-demand in `dev stats`
      });

      const totalDuration = (Date.now() - startTime) / 1000;

      // Finalize progress display
      progressRenderer.done();

      // Show final summary with next steps
      output.log(
        formatFinalSummary({
          code: {
            files: stats.filesScanned,
            documents: stats.documentsIndexed,
          },
          totalDuration,
        })
      );

      // Show errors if any
      if (stats.errors.length > 0) {
        output.log('');
        output.warn(`${stats.errors.length} error(s) occurred during indexing`);
        if (options.verbose) {
          for (const error of stats.errors) {
            output.log(`  ${chalk.gray(error.file)}: ${error.message}`);
          }
        } else {
          output.log(
            `  ${chalk.gray('Run with')} ${chalk.cyan('--verbose')} ${chalk.gray('to see details')}`
          );
        }
      }

      output.log('');
    } catch (error) {
      spinner.fail('Failed to index repository');
      logger.error(error instanceof Error ? error.message : String(error));
      if (options.verbose && error instanceof Error && error.stack) {
        logger.debug(error.stack);
      }
      process.exit(1);
    }
  });
