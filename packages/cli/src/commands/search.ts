import * as path from 'node:path';
import {
  ensureStorageDirectory,
  getStorageFilePaths,
  getStoragePath,
  RepositoryIndexer,
} from '@prosdevlab/dev-agent-core';
import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';
import { loadConfig } from '../utils/config.js';
import { prepareFileForSearch } from '../utils/file.js';
import { logger } from '../utils/logger.js';
import { formatSearchResults, output } from '../utils/output.js';

export const searchCommand = new Command('search')
  .description('Search indexed code semantically')
  .argument('[query]', 'Search query (optional with --similar-to)')
  .option('-l, --limit <number>', 'Maximum number of results', '10')
  .option('-t, --threshold <number>', 'Minimum similarity score', '0')
  .option('-s, --similar-to <file>', 'Find code similar to a file')
  .option('--json', 'Output results as JSON', false)
  .option('-v, --verbose', 'Show detailed results with signatures and docs', false)
  .action(async (query: string | undefined, options) => {
    if (!query && !options.similarTo) {
      console.error('Provide a search query or use --similar-to <file>');
      process.exit(1);
    }

    const spinner = ora('Searching...').start();

    try {
      const config = await loadConfig();
      const repositoryPath = config?.repository?.path || config?.repositoryPath || process.cwd();
      const resolvedRepoPath = path.resolve(repositoryPath);

      const storagePath = await getStoragePath(resolvedRepoPath);
      await ensureStorageDirectory(storagePath);
      const filePaths = getStorageFilePaths(storagePath);

      const indexer = new RepositoryIndexer({
        repositoryPath: resolvedRepoPath,
        vectorStorePath: filePaths.vectors,
        excludePatterns: config?.repository?.excludePatterns || config?.excludePatterns,
        languages: config?.repository?.languages || config?.languages,
      });

      await indexer.initialize();

      // If --similar-to is provided, use file content as the search query
      let searchQuery = query || '';
      let similarFile = '';
      if (options.similarTo) {
        spinner.text = 'Reading file content...';
        try {
          const fileInfo = await prepareFileForSearch(resolvedRepoPath, options.similarTo);
          searchQuery = fileInfo.content;
          similarFile = fileInfo.relativePath;
        } catch (error) {
          spinner.fail((error as Error).message);
          await indexer.close();
          process.exit(1);
        }
      }

      spinner.text = options.similarTo
        ? `Finding code similar to: ${chalk.cyan(options.similarTo)}`
        : `Searching for: ${chalk.cyan(query)}`;

      const limit = Number.parseInt(options.limit, 10);
      const results = await indexer.search(searchQuery, {
        limit: similarFile ? limit + 1 : limit,
        scoreThreshold: Number.parseFloat(options.threshold),
      });

      await indexer.close();

      // Filter out the source file for similar-to searches
      const filtered = similarFile
        ? results.filter((r) => (r.metadata.path as string) !== similarFile).slice(0, limit)
        : results;

      spinner.stop();

      if (filtered.length === 0) {
        output.log('');
        output.warn('No results found. Try:');
        output.log(`  • Different keywords`);
        output.log(`  • Re-index: ${chalk.cyan('dev index --force')}`);
        output.log('');
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(filtered, null, 2));
        return;
      }

      output.log('');
      output.success(`Found ${filtered.length} result(s)`);
      output.log('');
      output.log(formatSearchResults(filtered, resolvedRepoPath, { verbose: options.verbose }));
      output.log('');
    } catch (error) {
      spinner.fail('Search failed');
      logger.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });
