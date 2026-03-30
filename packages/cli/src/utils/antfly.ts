/**
 * Antfly server lifecycle management
 *
 * Docker-first, native fallback. The user never needs to run `antfly` directly.
 */

import { execSync, spawn } from 'node:child_process';
import { logger } from './logger.js';

const DEFAULT_ANTFLY_URL = process.env.ANTFLY_URL ?? 'http://localhost:18080/api/v1';
const CONTAINER_NAME = 'dev-agent-antfly';
const DOCKER_IMAGE = 'ghcr.io/antflydb/antfly:latest';
const DOCKER_PORT = 18080;
const STARTUP_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 500;

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
    const child = spawn(
      'antfly',
      [
        'swarm',
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
 */
export function pullModel(model: string): void {
  execSync(`antfly termite pull ${model}`, { stdio: 'inherit' });
}

/**
 * Pull a Termite embedding model inside the Docker container.
 * Uses stdio: 'inherit' so Antfly's native progress output shows through.
 */
export function pullModelDocker(model: string): void {
  execSync(`docker exec ${CONTAINER_NAME} /antfly termite pull ${model}`, { stdio: 'inherit' });
}

/**
 * Check if a Termite model is available locally (native binary).
 */
export function hasModel(model: string): boolean {
  try {
    const output = execSync('antfly termite list', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const shortName = model.split('/').pop() ?? model;
    return output.includes(shortName);
  } catch {
    return false;
  }
}

/**
 * Check if a Termite model is available inside the Docker container.
 */
export function hasModelDocker(model: string): boolean {
  try {
    const output = execSync(`docker exec ${CONTAINER_NAME} /antfly termite list`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const shortName = model.split('/').pop() ?? model;
    return output.includes(shortName);
  } catch {
    return false;
  }
}
