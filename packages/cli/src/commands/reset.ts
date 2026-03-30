/**
 * dev reset — Tear down dev-agent's search backend and clean all data
 *
 * Stops and removes the Antfly container (Docker) or process (native),
 * then cleans indexed data so users can start fresh with `dev setup`.
 */

import { execSync } from 'node:child_process';
import * as readline from 'node:readline';
import { Command } from 'commander';
import ora from 'ora';
import { hasDocker, isContainerExists } from '../utils/antfly.js';

const CONTAINER_NAME = 'dev-agent-antfly';

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} (y/N) `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

export const resetCommand = new Command('reset')
  .description('Stop search backend and clean all data — start fresh with `dev setup`')
  .option('-f, --force', 'Skip confirmation prompt', false)
  .action(async (options) => {
    const spinner = ora();

    if (!options.force) {
      const shouldReset = await confirm(
        'This will stop Antfly and delete all indexed data. Continue?'
      );
      if (!shouldReset) {
        console.log('Cancelled.');
        return;
      }
    }

    try {
      // ── Stop and remove Antfly ──
      if (hasDocker() && isContainerExists()) {
        spinner.start('Stopping Antfly container...');
        try {
          execSync(`docker stop ${CONTAINER_NAME}`, { stdio: 'pipe' });
        } catch {
          // Already stopped
        }
        try {
          execSync(`docker rm ${CONTAINER_NAME}`, { stdio: 'pipe' });
        } catch {
          // Already removed
        }
        spinner.succeed('Antfly container removed');
      } else {
        // Try killing native process
        try {
          execSync('pkill -f "antfly swarm"', { stdio: 'pipe' });
          spinner.succeed('Antfly process stopped');
        } catch {
          spinner.succeed('Antfly not running');
        }
      }

      // ── Clean local data ──
      spinner.start('Cleaning indexed data...');
      try {
        const { rm } = await import('node:fs/promises');
        const { homedir } = await import('node:os');
        const { join } = await import('node:path');
        const dataDir = join(homedir(), '.dev-agent');
        await rm(dataDir, { recursive: true, force: true });
        spinner.succeed('Indexed data removed');
      } catch {
        spinner.succeed('No indexed data to clean');
      }

      console.log('\n  Reset complete. Run `dev setup` to start fresh.\n');
    } catch (error) {
      spinner.fail('Reset failed');
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });
