/**
 * dev setup — One-time setup for dev-agent's search backend
 *
 * Docker-first, native fallback. Handles installation, model download,
 * and server startup so users never need to run `antfly` directly.
 */

import { execSync } from 'node:child_process';
import * as readline from 'node:readline';
import { Command } from 'commander';
import ora from 'ora';
import {
  ensureAntfly,
  getAntflyUrl,
  getNativeVersion,
  hasDocker,
  hasModel,
  hasNativeBinary,
  isServerReady,
  pullModel,
} from '../utils/antfly.js';
import { logger } from '../utils/logger.js';

const DEFAULT_MODEL = 'BAAI/bge-small-en-v1.5';

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} (Y/n) `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() !== 'n');
    });
  });
}

export const setupCommand = new Command('setup')
  .description('One-time setup: install search backend and embedding model')
  .option('--model <name>', 'Termite embedding model', DEFAULT_MODEL)
  .action(async (options) => {
    const model = options.model as string;
    const spinner = ora();

    try {
      // ── Step 1: Check runtime ──
      if (hasDocker()) {
        logger.info('Docker found');

        // Check if server is already running
        if (await isServerReady()) {
          logger.info('Antfly server already running');
          logger.log("\n  Nothing to do — you're all set!\n");
          logger.log('  Next steps:');
          logger.log('    dev index .                    Index your repository');
          logger.log('    dev mcp install --cursor       Connect to Cursor\n');
          return;
        }

        // Pull image and start
        spinner.start('Pulling Antfly image...');
        try {
          execSync(`docker pull --platform linux/amd64 ${getDockerImage()}`, { stdio: 'pipe' });
          spinner.succeed('Antfly image ready');
        } catch {
          spinner.succeed('Antfly image available');
        }

        spinner.start('Starting Antfly server...');
        await ensureAntfly({ quiet: true });
        spinner.succeed(`Antfly running on ${getAntflyUrl()}`);
      } else if (hasNativeBinary()) {
        // ── Native fallback ──
        const version = getNativeVersion();
        logger.info(`Antfly ${version} found (native)`);
        logger.info('Docker not found — using native binary');

        // Check if server is already running
        if (await isServerReady()) {
          logger.info('Antfly server already running');
        } else {
          // Pull embedding model (Docker image bundles models, native needs manual pull)
          if (!hasModel(model)) {
            spinner.start(`Pulling embedding model: ${model}...`);
            pullModel(model);
            spinner.succeed(`Embedding model ready: ${model}`);
          } else {
            logger.info(`Embedding model ready: ${model}`);
          }

          spinner.start('Starting Antfly server...');
          await ensureAntfly({ quiet: true });
          spinner.succeed(`Antfly running on ${getAntflyUrl()}`);
        }
      } else {
        // ── Nothing installed ──
        const platform = process.platform;
        const installCmd =
          platform === 'darwin'
            ? 'brew install --cask antflydb/antfly/antfly'
            : 'curl -fsSL https://releases.antfly.io/antfly/latest/install.sh | sh -s -- --omni';

        if (hasDocker === undefined) {
          // This shouldn't happen but just in case
          logger.error('No runtime found.');
        }

        const shouldInstall = await confirm('\nAntfly is not installed. Install it now?');

        if (shouldInstall) {
          spinner.start(
            `Installing via ${platform === 'darwin' ? 'Homebrew' : 'install script'}...`
          );
          execSync(installCmd, { stdio: 'inherit' });
          spinner.succeed('Antfly installed');

          // Pull model and start
          if (!hasModel(model)) {
            spinner.start(`Pulling embedding model: ${model}...`);
            pullModel(model);
            spinner.succeed(`Embedding model ready: ${model}`);
          }

          spinner.start('Starting Antfly server...');
          await ensureAntfly({ quiet: true });
          spinner.succeed(`Antfly running on ${getAntflyUrl()}`);
        } else {
          logger.log('\nInstall manually, then run `dev setup` again:');
          logger.log(`  Docker:  https://docker.com/get-started`);
          logger.log(`  Native:  ${installCmd}\n`);
          return;
        }
      }

      // ── Success ──
      logger.log('\n  Setup complete!\n');
      logger.log('  Next steps:');
      logger.log('    dev index .                    Index your repository');
      logger.log('    dev mcp install --cursor       Connect to Cursor\n');
    } catch (error) {
      spinner.fail('Setup failed');
      logger.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

function getDockerImage(): string {
  return 'ghcr.io/antflydb/antfly:latest';
}
