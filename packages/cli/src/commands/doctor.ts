/**
 * dev doctor — Diagnose the dev-agent stack from the CLI.
 *
 * Works with nothing else running: checks the Antfly install, server
 * reachability (including port conflicts), embedding model, and repository
 * index, and points at the captured startup log on failure.
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { getStorageFilePaths, getStoragePath } from '@prosdevlab/dev-agent-core';
import chalk from 'chalk';
import { Command } from 'commander';
import {
  detectContainerRuntime,
  getAntflyLogPath,
  getAntflyUrl,
  getNativeVersion,
  hasModel,
  hasModelContainer,
  isServerReady,
} from '../utils/antfly.js';
import { loadConfig } from '../utils/config.js';
import { runDoctorChecks } from '../utils/doctor.js';

const DEFAULT_MODEL = 'BAAI/bge-small-en-v1.5';

function antflyPort(): string {
  try {
    return new URL(getAntflyUrl()).port || '18080';
  } catch {
    return '18080';
  }
}

export const doctorCommand = new Command('doctor')
  .description('Diagnose the dev-agent stack: Antfly install, server, model, index')
  .action(async () => {
    const config = await loadConfig();
    const repositoryPath = path.resolve(
      config?.repository?.path || config?.repositoryPath || process.cwd()
    );

    const checks = await runDoctorChecks({
      nativeVersion: getNativeVersion,
      containerRuntime: () => detectContainerRuntime(),
      serverReady: () => isServerReady(),
      portOwner: () => {
        try {
          const out = execSync(`lsof -i :${antflyPort()} -t`, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
          }).trim();
          return out || null;
        } catch {
          return null;
        }
      },
      modelPresent: () => {
        if (getNativeVersion()) return hasModel(DEFAULT_MODEL);
        const runtime = detectContainerRuntime();
        if (runtime) return hasModelContainer(runtime, DEFAULT_MODEL);
        return false;
      },
      indexExists: async () => {
        const storagePath = await getStoragePath(repositoryPath);
        return existsSync(getStorageFilePaths(storagePath).dependencyGraph);
      },
      logPath: () => getAntflyLogPath(),
    });

    console.log();
    for (const check of checks) {
      const mark = check.ok ? chalk.green('✓') : chalk.red('✗');
      console.log(` ${mark} ${check.name} — ${check.detail}`);
      if (!check.ok && check.hint) {
        console.log(`     ${chalk.dim(check.hint)}`);
      }
    }
    console.log();

    if (checks.every((c) => c.ok)) {
      console.log(chalk.green(' All checks passed.\n'));
    } else {
      console.log(chalk.red(' Some checks failed — see hints above.\n'));
      process.exit(1);
    }
  });
