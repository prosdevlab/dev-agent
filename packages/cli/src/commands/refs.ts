import * as path from 'node:path';
import {
  buildDependencyGraph,
  ensureStorageDirectory,
  getStorageFilePaths,
  getStoragePath,
  RepositoryIndexer,
  type SearchResult,
  shortestPath,
} from '@prosdevlab/dev-agent-core';
import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';
import { loadConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';

type RefDirection = 'callees' | 'callers' | 'both';

interface CalleeInfo {
  name: string;
  file?: string;
  line: number;
}

export const refsCommand = new Command('refs')
  .description('Find callers and callees of a function')
  .argument('<name>', 'Function or method name (e.g., "createPlan", "SearchAdapter.execute")')
  .option('-d, --direction <direction>', 'Query direction: callees, callers, or both', 'both')
  .option('-l, --limit <number>', 'Maximum results per direction', '20')
  .option('--depends-on <file>', 'Trace dependency path to a target file')
  .option('--json', 'Output results as JSON', false)
  .action(async (name: string, options) => {
    const spinner = ora('Finding references...').start();

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
      });

      await indexer.initialize();

      const direction = options.direction as RefDirection;
      const limit = Number.parseInt(options.limit, 10);

      // Find the target symbol
      const searchResults = await indexer.search(name, { limit: 10 });
      const target = findBestMatch(searchResults, name);

      if (!target) {
        spinner.fail(`Could not find "${name}"`);
        await indexer.close();
        process.exit(1);
      }

      // Handle --depends-on
      if (options.dependsOn) {
        spinner.text = `Tracing path: ${name} → ${options.dependsOn}`;
        const allDocs = await indexer.getAll({ limit: 50000 });
        const graph = buildDependencyGraph(allDocs);
        const sourceFile = (target.metadata.path as string) || '';
        const tracePath = shortestPath(graph, sourceFile, options.dependsOn);

        spinner.stop();

        if (options.json) {
          console.log(JSON.stringify({ from: sourceFile, to: options.dependsOn, path: tracePath }));
          await indexer.close();
          return;
        }

        console.log('');
        if (tracePath) {
          console.log(chalk.bold(`Dependency path: ${sourceFile} → ${options.dependsOn}`));
          console.log('');
          console.log(`  ${tracePath.join(chalk.dim(' → '))}`);
          console.log('');
          console.log(
            chalk.dim(`  ${tracePath.length - 1} hop${tracePath.length - 1 === 1 ? '' : 's'}`)
          );
        } else {
          console.log(chalk.yellow(`No path found from ${sourceFile} to ${options.dependsOn}`));
          console.log(chalk.dim('  These files may be in separate subsystems.'));
        }
        console.log('');
        await indexer.close();
        return;
      }

      // Get callees
      let callees: CalleeInfo[] = [];
      if (direction === 'callees' || direction === 'both') {
        const rawCallees = target.metadata.callees as CalleeInfo[] | undefined;
        callees = (rawCallees || []).slice(0, limit);
      }

      // Get callers
      const callers: Array<{ name: string; file?: string; line: number; type?: string }> = [];
      if (direction === 'callers' || direction === 'both') {
        const targetName = target.metadata.name as string;
        const candidates = await indexer.search(targetName, { limit: 100 });

        for (const candidate of candidates) {
          if (candidate.id === target.id) continue;
          const candidateCallees = candidate.metadata.callees as CalleeInfo[] | undefined;
          if (!candidateCallees) continue;

          const callsTarget = candidateCallees.some(
            (c) =>
              c.name === targetName ||
              c.name.endsWith(`.${targetName}`) ||
              targetName.endsWith(`.${c.name}`)
          );

          if (callsTarget) {
            callers.push({
              name: (candidate.metadata.name as string) || 'unknown',
              file: candidate.metadata.path as string,
              line: (candidate.metadata.startLine as number) || 0,
              type: candidate.metadata.type as string,
            });
            if (callers.length >= limit) break;
          }
        }
      }

      await indexer.close();
      spinner.stop();

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              target: {
                name: target.metadata.name,
                file: target.metadata.path,
                line: target.metadata.startLine,
                type: target.metadata.type,
              },
              callees: direction === 'callers' ? undefined : callees,
              callers: direction === 'callees' ? undefined : callers,
            },
            null,
            2
          )
        );
        return;
      }

      // Format output
      const targetFile = (target.metadata.path as string) || '';
      const targetLine = (target.metadata.startLine as number) || 0;
      const relFile = targetFile.startsWith(resolvedRepoPath)
        ? targetFile.slice(resolvedRepoPath.length + 1)
        : targetFile;

      console.log('');
      console.log(chalk.bold(`${target.metadata.name}`));
      console.log(chalk.dim(`  ${relFile}:${targetLine}  ${target.metadata.type}`));
      console.log('');

      if (direction === 'callees' || direction === 'both') {
        console.log(chalk.cyan.bold('Callees') + chalk.dim(' (what this calls)'));
        if (callees.length > 0) {
          for (const c of callees) {
            const loc = c.file ? chalk.dim(`${c.file}:${c.line}`) : chalk.dim(`line ${c.line}`);
            console.log(`  ${c.name}  ${loc}`);
          }
        } else {
          console.log(chalk.dim('  No callees found'));
        }
        console.log('');
      }

      if (direction === 'callers' || direction === 'both') {
        console.log(chalk.cyan.bold('Callers') + chalk.dim(' (what calls this)'));
        if (callers.length > 0) {
          for (const c of callers) {
            const loc = c.file ? chalk.dim(`${c.file}:${c.line}`) : chalk.dim(`line ${c.line}`);
            console.log(`  ${c.name}  ${loc}  ${chalk.dim(c.type || '')}`);
          }
        } else {
          console.log(chalk.dim('  No callers found'));
        }
        console.log('');
      }
    } catch (error) {
      spinner.fail('Refs query failed');
      logger.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

function findBestMatch(results: SearchResult[], name: string) {
  if (results.length === 0) return null;
  const exact = results.find(
    (r) => r.metadata.name === name || (r.metadata.name as string)?.endsWith(`.${name}`)
  );
  return exact || results[0];
}
