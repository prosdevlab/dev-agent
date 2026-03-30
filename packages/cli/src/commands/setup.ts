/**
 * dev setup — One-time setup for dev-agent's search backend
 *
 * Docker-first, native fallback. Handles installation, model download,
 * and server startup so users never need to run `antfly` directly.
 */

import { execSync, spawn } from 'node:child_process';
import * as readline from 'node:readline';
import { Command } from 'commander';
import ora from 'ora';
import {
  ensureAntfly,
  getAntflyUrl,
  getDockerMemoryBytes,
  getNativeVersion,
  hasDocker,
  hasModel,
  hasModelDocker,
  hasNativeBinary,
  isServerReady,
  pullModel,
  pullModelDocker,
} from '../utils/antfly.js';

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

function dockerPull(image: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['pull', '--platform', 'linux/amd64', image], {
      stdio: 'pipe',
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`docker pull exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

function printNextSteps(): void {
  console.log();
  console.log('  Next steps:');
  console.log('    dev index                      Index your repository');
  console.log('    dev mcp install --cursor       Connect to Cursor');
  console.log();
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
        // Warn if Docker has less than 4GB allocated
        const dockerMem = getDockerMemoryBytes();
        if (dockerMem && dockerMem < 4 * 1024 * 1024 * 1024) {
          const memGB = (dockerMem / (1024 * 1024 * 1024)).toFixed(1);
          spinner.warn(
            `Docker has only ${memGB}GB memory. Increase to 8GB+ in Docker Desktop → Settings → Resources.`
          );
        }

        // Check if server is already running
        if (await isServerReady()) {
          spinner.succeed('Antfly already running');

          // Ensure model is available even if server was already up
          if (!hasModelDocker(model)) {
            console.log(`  Pulling embedding model: ${model}`);
            pullModelDocker(model);
            spinner.succeed(`Embedding model ready: ${model}`);
          } else {
            spinner.succeed(`Embedding model ready: ${model}`);
          }

          console.log('\n  Setup complete!');
          printNextSteps();
          return;
        }

        // Pull image and start
        spinner.start('Pulling Antfly image...');
        try {
          await dockerPull(getDockerImage());
          spinner.succeed('Antfly image ready');
        } catch {
          spinner.succeed('Antfly image available');
        }

        spinner.start('Starting Antfly server...');
        await ensureAntfly({ quiet: true });
        spinner.succeed(`Antfly running on ${getAntflyUrl()}`);

        // Pull embedding model inside container
        if (!hasModelDocker(model)) {
          console.log(`  Pulling embedding model: ${model}`);
          pullModelDocker(model);
          spinner.succeed(`Embedding model ready: ${model}`);
        } else {
          spinner.succeed(`Embedding model ready: ${model}`);
        }
      } else if (hasNativeBinary()) {
        // ── Native fallback ──
        const version = getNativeVersion();

        // Check if server is already running
        if (await isServerReady()) {
          spinner.succeed(`Antfly ${version} already running`);
          console.log("\n  Nothing to do — you're all set!");
          printNextSteps();
          return;
        }

        // Pull embedding model (Docker image bundles models, native needs manual pull)
        if (!hasModel(model)) {
          spinner.start(`Pulling embedding model: ${model}...`);
          pullModel(model);
          spinner.succeed(`Embedding model ready: ${model}`);
        } else {
          spinner.succeed(`Embedding model ready: ${model}`);
        }

        spinner.start('Starting Antfly server...');
        await ensureAntfly({ quiet: true });
        spinner.succeed(`Antfly running on ${getAntflyUrl()}`);
      } else {
        // ── Nothing installed ──
        const platform = process.platform;
        const installCmd =
          platform === 'darwin'
            ? 'brew install --cask antflydb/antfly/antfly'
            : 'curl -fsSL https://releases.antfly.io/antfly/latest/install.sh | sh -s -- --omni';

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
          console.log('\nInstall manually, then run `dev setup` again:');
          console.log(`  Docker:  https://docker.com/get-started`);
          console.log(`  Native:  ${installCmd}\n`);
          return;
        }
      }

      // ── Success ──
      console.log('\n  Setup complete!');
      printNextSteps();
    } catch (error) {
      spinner.fail('Setup failed');
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

function getDockerImage(): string {
  return 'ghcr.io/antflydb/antfly:latest';
}
