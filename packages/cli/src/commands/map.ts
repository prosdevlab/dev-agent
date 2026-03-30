/**
 * Map Command
 * Show codebase structure with component counts and change frequency
 */

import * as path from 'node:path';
import {
  ensureStorageDirectory,
  formatCodebaseMap,
  generateCodebaseMap,
  getStorageFilePaths,
  getStoragePath,
  LocalGitExtractor,
  type MapOptions,
  RepositoryIndexer,
} from '@prosdevlab/dev-agent-core';
import { createLogger } from '@prosdevlab/kero';
import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';
import { loadConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { output } from '../utils/output.js';

export const mapCommand = new Command('map')
  .description('Show codebase structure with component counts')
  .option('-d, --depth <number>', 'Directory depth to show (1-5)', '2')
  .option('-f, --focus <path>', 'Focus on a specific directory path')
  .option('--no-exports', 'Hide exported symbols')
  .option('--change-frequency', 'Include git change frequency (hotspots)', false)
  .option('--token-budget <number>', 'Maximum tokens for output', '2000')
  .option('--verbose', 'Enable debug logging', false)
  .addHelpText(
    'after',
    `
Examples:
  $ dev map                           Show structure at depth 2
  $ dev map --depth 3                 Show deeper nesting
  $ dev map --focus packages/core     Focus on specific directory
  $ dev map --change-frequency        Show git activity hotspots

What You'll See:
  📊 Directory structure with component counts
  📦 Classes, functions, interfaces per directory
  🔥 Hot files (with --change-frequency)
  📤 Key exports per directory

Use Case:
  - Understanding codebase organization
  - Finding where code lives
  - Identifying hotspots and frequently changed areas
  - Better than 'ls' or 'tree' for code exploration
`
  )
  .action(async (options) => {
    const startTime = Date.now();

    // Create logger with debug enabled if --verbose
    const mapLogger = createLogger({
      level: options.verbose ? 'debug' : 'warn',
      format: 'pretty',
    });

    const spinner = ora('Loading configuration...').start();

    try {
      const config = await loadConfig();
      const repositoryPath = config?.repository?.path || config?.repositoryPath || process.cwd();
      const resolvedRepoPath = path.resolve(repositoryPath);

      spinner.text = 'Initializing indexer...';
      const t1 = Date.now();
      mapLogger.info({ repositoryPath: resolvedRepoPath }, 'Loading repository configuration');

      const storagePath = await getStoragePath(resolvedRepoPath);
      await ensureStorageDirectory(storagePath);
      const filePaths = getStorageFilePaths(storagePath);
      mapLogger.debug({ storagePath, filePaths }, 'Storage paths resolved');

      const indexer = new RepositoryIndexer({
        repositoryPath: resolvedRepoPath,
        vectorStorePath: filePaths.vectors,
      });

      // Skip embedder initialization for read-only map generation (10-20x faster)
      mapLogger.info('Initializing indexer (skipping embedder for fast read-only access)');
      await indexer.initialize({ skipEmbedder: true });
      const t2 = Date.now();
      mapLogger.info({ duration_ms: t2 - t1 }, 'Indexer initialized');
      spinner.text = `Indexer initialized (${t2 - t1}ms). Generating map...`;

      // Check if repository is indexed
      mapLogger.debug('Checking if repository is indexed');
      const stats = await indexer.getStats();
      if (!stats) {
        spinner.fail('Repository not indexed');
        await indexer.close();
        logger.warn('No indexed data found.');
        console.log('');
        console.log(chalk.yellow('📌 This command requires indexing your repository:'));
        console.log('');
        console.log(chalk.white('   dev index'));
        console.log('');
        console.log(chalk.dim('   This is a one-time operation. Run in your repository root.'));
        console.log('');
        process.exit(0);
      }

      mapLogger.info(
        {
          filesScanned: stats.filesScanned,
          documentsIndexed: stats.documentsIndexed,
        },
        'Repository index loaded'
      );

      spinner.text = 'Generating codebase map...';

      // Parse options
      mapLogger.debug(
        { rawDepth: options.depth, rawTokenBudget: options.tokenBudget },
        'Parsing options'
      );
      const depth = Number.parseInt(options.depth, 10);
      if (Number.isNaN(depth) || depth < 1 || depth > 5) {
        spinner.fail('Invalid depth');
        logger.error('Depth must be between 1 and 5');
        await indexer.close();
        process.exit(1);
      }

      const tokenBudget = Number.parseInt(options.tokenBudget, 10);
      if (Number.isNaN(tokenBudget) || tokenBudget < 500) {
        spinner.fail('Invalid token budget');
        logger.error('Token budget must be at least 500');
        await indexer.close();
        process.exit(1);
      }

      // Create git extractor for change frequency if requested
      const gitExtractor = options.changeFrequency
        ? new LocalGitExtractor(resolvedRepoPath)
        : undefined;

      if (options.changeFrequency) {
        mapLogger.info('Git change frequency analysis enabled');
      }

      // Generate map
      const mapOptions: MapOptions = {
        depth,
        focus: options.focus,
        includeExports: options.exports,
        tokenBudget,
        includeChangeFrequency: options.changeFrequency,
      };

      mapLogger.info(
        {
          depth,
          focus: options.focus || '(all)',
          includeExports: options.exports,
          tokenBudget,
          includeChangeFrequency: options.changeFrequency,
        },
        'Starting map generation'
      );

      const t3 = Date.now();
      const map = await generateCodebaseMap(
        {
          indexer,
          gitExtractor,
          logger: mapLogger,
        },
        mapOptions
      );
      const t4 = Date.now();

      mapLogger.success(
        {
          totalDuration_ms: t4 - startTime,
          initDuration_ms: t2 - t1,
          mapDuration_ms: t4 - t3,
          totalComponents: map.totalComponents,
          totalDirectories: map.totalDirectories,
        },
        'Map generation complete'
      );

      const duration = ((t4 - startTime) / 1000).toFixed(1);
      spinner.succeed(`Map generated (${duration}s)`);

      const formatted = formatCodebaseMap(map, {
        includeExports: options.exports,
        includeChangeFrequency: options.changeFrequency,
        repositoryPath: resolvedRepoPath,
      });

      console.log('');
      console.log(formatted);
      console.log('');
      console.log('  Try:');
      console.log('    dev search "<query>"            Search indexed code');
      console.log('    dev map --depth 3               Show deeper structure');
      console.log('    dev map --focus packages/core    Focus on a directory');
      console.log('');

      await indexer.close();
    } catch (error) {
      spinner.fail('Failed to generate map');
      logger.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });
