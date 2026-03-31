/**
 * Antfly server lifecycle management
 *
 * Docker-first, native fallback. The user never needs to run `antfly` directly.
 */

import { execSync, spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { logger } from './logger.js';

const DEFAULT_ANTFLY_URL = process.env.ANTFLY_URL ?? 'http://localhost:18080/api/v1';
const CONTAINER_NAME = 'dev-agent-antfly';
const DOCKER_IMAGE = 'ghcr.io/antflydb/antfly:latest';
const DOCKER_PORT = 18080;
const STARTUP_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 500;

/**
 * The Termite models directory used by the running Antfly swarm server.
 *
 * `antfly swarm` uses `--data-dir` (default: ~/.antfly) as its root for all
 * storage, including Termite models at {data-dir}/models.
 * `antfly termite list/pull` defaults to --models-dir ~/.termite/models, which
 * is a DIFFERENT path. We must always pass --models-dir explicitly so that
 * `pullModel` and `hasModel` operate on the same directory the server uses.
 */
const ANTFLY_DATA_DIR = process.env.ANTFLY_DATA_DIR ?? join(homedir(), '.antfly');
const TERMITE_MODELS_DIR = join(ANTFLY_DATA_DIR, 'models');

/**
 * Ensure antfly is running. Auto-starts if needed.
 *
 * Priority: Docker container → native binary → error with guidance.
 */
export async function ensureAntfly(options?: { quiet?: boolean }): Promise<string> {
  const url = getAntflyUrl();

  // 1. Already running?
  if (await isServerReady(url)) {
    return url;
  }

  // 2. Try native first (no VM overhead, better performance)
  if (hasNativeBinary()) {
    if (!options?.quiet) logger.info('Starting Antfly server...');
    // Use custom ports to avoid 8080 conflicts (Docker, other services).
    // metadata-api on 18080 (our default), store-api on 18381, raft on 19017/19021.
    // --data-dir is passed explicitly so the server's embedded Termite node stores
    // models in the same directory that pullModel/hasModel use (TERMITE_MODELS_DIR).
    const child = spawn(
      'antfly',
      [
        'swarm',
        '--data-dir',
        ANTFLY_DATA_DIR,
        '--metadata-api',
        'http://0.0.0.0:18080',
        '--store-api',
        'http://0.0.0.0:18381',
        '--metadata-raft',
        'http://0.0.0.0:19017',
        '--store-raft',
        'http://0.0.0.0:19021',
        '--health-port',
        '14200',
      ],
      {
        detached: true,
        stdio: 'ignore',
      }
    );
    child.unref();

    await waitForServer(url);
    if (!options?.quiet) logger.info(`Antfly running on ${url}`);
    return url;
  }

  // 3. Docker fallback
  if (hasDocker()) {
    if (isContainerExists()) {
      if (!options?.quiet) logger.info('Starting Antfly container...');
      execSync(`docker start ${CONTAINER_NAME}`, { stdio: 'pipe' });
    } else {
      if (!options?.quiet) logger.info('Starting Antfly via Docker...');
      execSync(
        `docker run -d --name ${CONTAINER_NAME} -p ${DOCKER_PORT}:8080 -m 8g --platform linux/amd64 ${DOCKER_IMAGE} swarm`,
        { stdio: 'pipe' }
      );
    }

    await waitForServer(url);
    if (!options?.quiet) logger.info(`Antfly running on ${url}`);
    return url;
  }

  // 4. Nothing available
  throw new Error(
    'Antfly is not installed. Run `dev setup` to install:\n' +
      '  brew install --cask antflydb/antfly/antfly'
  );
}

export function getAntflyUrl(): string {
  return process.env.ANTFLY_URL ?? DEFAULT_ANTFLY_URL;
}

export function hasDocker(): boolean {
  try {
    execSync('docker info', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get Docker's total allocated memory in bytes.
 */
export function getDockerMemoryBytes(): number | null {
  try {
    const output = execSync('docker info 2>&1', { encoding: 'utf-8', timeout: 5000 });
    const match = output.match(/memTotal:\s*(\d+)/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

export function hasNativeBinary(): boolean {
  try {
    execSync('antfly --version', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export function isContainerExists(): boolean {
  try {
    const result = execSync(`docker ps -a --filter name=${CONTAINER_NAME} --format "{{.Names}}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim() === CONTAINER_NAME;
  } catch {
    return false;
  }
}

export async function isServerReady(url?: string): Promise<boolean> {
  const baseUrl = (url ?? getAntflyUrl()).replace('/api/v1', '');
  try {
    const resp = await fetch(`${baseUrl}/api/v1/tables`, { signal: AbortSignal.timeout(3000) });
    return resp.ok;
  } catch {
    return false;
  }
}

async function waitForServer(url: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < STARTUP_TIMEOUT_MS) {
    if (await isServerReady(url)) return;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  // Check if port is in use by another process
  try {
    const { execSync: exec } = await import('node:child_process');
    const lsof = exec(`lsof -i :${DOCKER_PORT} -t`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (lsof) {
      throw new Error(
        `Port ${DOCKER_PORT} is already in use (pid: ${lsof}).\n` +
          `  Check: lsof -i :${DOCKER_PORT}\n` +
          `  Or set: ANTFLY_URL=http://localhost:<other-port>/api/v1`
      );
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('Port')) throw e;
  }

  throw new Error(
    `Antfly server did not start within ${STARTUP_TIMEOUT_MS / 1000}s.\n` +
      `  Try: dev reset && dev setup`
  );
}

/**
 * Get the antfly version (native binary).
 */
export function getNativeVersion(): string | null {
  try {
    return execSync('antfly --version', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Pull a Termite embedding model (native binary).
 *
 * Always targets TERMITE_MODELS_DIR so the model ends up in the same directory
 * the running Antfly swarm server uses for its embedded Termite node.
 */
export function pullModel(model: string): void {
  execSync(`antfly termite pull --models-dir ${TERMITE_MODELS_DIR} ${model}`, {
    stdio: 'inherit',
  });
}

/**
 * Pull a Termite embedding model inside the Docker container.
 * Uses stdio: 'inherit' so Antfly's native progress output shows through.
 */
export function pullModelDocker(model: string): void {
  execSync(`docker exec ${CONTAINER_NAME} /antfly termite pull ${model}`, { stdio: 'inherit' });
}

/**
 * Check if a Termite model is available in the directory used by the running
 * Antfly swarm server (TERMITE_MODELS_DIR = ~/.antfly/models by default).
 *
 * Checks for the full model name first (e.g. "BAAI/bge-small-en-v1.5"), then
 * the short name as a whole word (e.g. "bge-small-en-v1.5"). Previously used
 * a simple substring match on the short name, which caused false positives when
 * `antfly termite list` defaulted to ~/.termite/models — a different directory
 * from the one the server reads, so the model appeared present but was not
 * available to the server during embedding.
 */
export function hasModel(model: string): boolean {
  try {
    const output = execSync(`antfly termite list --models-dir ${TERMITE_MODELS_DIR}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return modelPresentInOutput(model, output);
  } catch {
    return false;
  }
}

/**
 * Check if a Termite model is available inside the Docker container.
 *
 * Checks for the full model name first (e.g. "BAAI/bge-small-en-v1.5"), then
 * the short name as a whole word (e.g. "bge-small-en-v1.5"). Simple substring
 * matching on the short name was causing false positives when other models or
 * partial download records shared the suffix.
 */
export function hasModelDocker(model: string): boolean {
  try {
    const output = execSync(`docker exec ${CONTAINER_NAME} /antfly termite list`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return modelPresentInOutput(model, output);
  } catch {
    return false;
  }
}

/**
 * Return true when the model name is present in `antfly termite list` output.
 *
 * Strategy (most-specific first):
 *   1. Full name exact match  — "BAAI/bge-small-en-v1.5" appears verbatim.
 *   2. Short name word-boundary — "bge-small-en-v1.5" appears as a whole token
 *      (not as a suffix of a different model name).
 */
function modelPresentInOutput(model: string, output: string): boolean {
  // Full name check (covers "BAAI/bge-small-en-v1.5" style output)
  if (output.includes(model)) return true;

  // Short name check with word-boundary anchors so "bge-small-en-v1.5" does not
  // match inside "other-bge-small-en-v1.5" or a partial download entry.
  const shortName = model.split('/').pop() ?? model;
  const escaped = shortName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w/-])${escaped}(?![\\w/-])`).test(output);
}
