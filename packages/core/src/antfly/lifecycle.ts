/**
 * Antfly server lifecycle management — the single shared implementation.
 *
 * Consumed by the CLI (`dev setup`, `dev index`, `dev doctor`), the MCP server
 * entry point (startup auto-start), and the adapter registry (mid-session
 * recovery). Native binary first, container runtime (docker or podman)
 * fallback. The user never needs to run `antfly` directly.
 *
 * All spawned Antfly output is captured to a log file (see getAntflyLogPath)
 * so failed starts are diagnosable after the fact.
 */

import { execFileSync, execSync, spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, renameSync, statSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_ANTFLY_URL = 'http://localhost:18080/api/v1';
export const ANTFLY_CONTAINER_NAME = 'dev-agent-antfly';
export const ANTFLY_CONTAINER_IMAGE = 'ghcr.io/antflydb/antfly:latest';
const ANTFLY_PORT = 18080;
const STARTUP_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 500;
const LOG_ROTATE_BYTES = 5 * 1024 * 1024;

export type ContainerRuntime = 'docker' | 'podman';

export function getAntflyUrl(): string {
  return process.env.ANTFLY_URL ?? DEFAULT_ANTFLY_URL;
}

/**
 * `antfly swarm` uses `--data-dir` (default: ~/.antfly) as its root for all
 * storage, including Termite models at {data-dir}/models. We always pass it
 * explicitly so model tooling and the server agree on paths.
 */
export function getAntflyDataDir(): string {
  return process.env.ANTFLY_DATA_DIR ?? join(homedir(), '.antfly');
}

export function getTermiteModelsDir(): string {
  return join(getAntflyDataDir(), 'models');
}

export function getAntflyLogPath(dataDir: string = getAntflyDataDir()): string {
  return join(dataDir, 'antfly.log');
}

/**
 * Canonical `antfly swarm` arguments. Custom ports avoid 8080 conflicts
 * (Docker, other services): metadata-api on 18080 (our default URL),
 * store-api on 18381, raft on 19017/19021, health on 14200.
 */
export function buildSwarmArgs(dataDir: string = getAntflyDataDir()): string[] {
  return [
    'swarm',
    '--data-dir',
    dataDir,
    '--metadata-api',
    `http://0.0.0.0:${ANTFLY_PORT}`,
    '--store-api',
    'http://0.0.0.0:18381',
    '--metadata-raft',
    'http://0.0.0.0:19017',
    '--store-raft',
    'http://0.0.0.0:19021',
    '--health-port',
    '14200',
  ];
}

/** Probe returning true when a command exits 0. */
export type CommandProbe = (command: string) => boolean;

const defaultProbe: CommandProbe = (command) => {
  try {
    execSync(command, { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
};

export function hasNativeBinary(probe: CommandProbe = defaultProbe): boolean {
  return probe('antfly --version');
}

export function detectContainerRuntime(
  probe: CommandProbe = defaultProbe
): ContainerRuntime | null {
  if (probe('docker info')) return 'docker';
  if (probe('podman info')) return 'podman';
  return null;
}

export function containerStartCommand(runtime: ContainerRuntime, name: string): string {
  return `${runtime} start ${name}`;
}

export function containerRunCommand(
  runtime: ContainerRuntime,
  options: { name: string; image: string; port: number }
): string {
  return (
    `${runtime} run -d --name ${options.name} -p ${options.port}:8080 ` +
    `-m 8g --platform linux/amd64 ${options.image} swarm`
  );
}

export function containerExists(
  runtime: ContainerRuntime,
  name: string = ANTFLY_CONTAINER_NAME
): boolean {
  try {
    const result = execSync(`${runtime} ps -a --filter name=${name} --format "{{.Names}}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim() === name;
  } catch {
    return false;
  }
}

export async function isServerReady(url: string = getAntflyUrl()): Promise<boolean> {
  const baseUrl = url.replace('/api/v1', '');
  try {
    const resp = await fetch(`${baseUrl}/api/v1/tables`, { signal: AbortSignal.timeout(3000) });
    return resp.ok;
  } catch {
    return false;
  }
}

export interface StartAntflyProcessOptions {
  /** Override binary for tests. Defaults to `antfly`. */
  command?: string;
  /** Override args for tests. Defaults to buildSwarmArgs(). */
  args?: string[];
  /** Where child stdout/stderr land. Defaults to getAntflyLogPath(). */
  logPath?: string;
}

/**
 * Spawn a detached Antfly process with its output captured to the log file.
 * Never spawn with stdio:'ignore' — a failed start with discarded output is
 * undiagnosable (the exact failure mode that motivated this module).
 */
export function startAntflyProcess(options: StartAntflyProcessOptions = {}): void {
  const logPath = options.logPath ?? getAntflyLogPath();
  const fd = openLogFile(logPath);
  // The finally is load-bearing: callers (BackendGate) retry on every failed
  // tool call, so a leaked fd per attempt would accumulate toward EMFILE.
  try {
    writeSync(
      fd,
      `[dev-agent] starting ${options.command ?? 'antfly'} at ${new Date().toISOString()}\n`
    );

    const child = spawn(options.command ?? 'antfly', options.args ?? buildSwarmArgs(), {
      detached: true,
      stdio: ['ignore', fd, fd],
    });
    child.unref();
  } finally {
    // The child holds its own copy of the descriptor.
    closeSync(fd);
  }
}

function openLogFile(logPath: string): number {
  mkdirSync(join(logPath, '..'), { recursive: true });
  try {
    if (statSync(logPath).size > LOG_ROTATE_BYTES) {
      renameSync(logPath, `${logPath}.old`);
    }
  } catch {
    // no existing log
  }
  return openSync(logPath, 'a');
}

/** Error message for tool responses when Antfly cannot be reached/recovered. */
export function antflyUnavailableMessage(logPath: string = getAntflyLogPath()): string {
  return (
    'Antfly search backend is not running and could not be started. ' +
    'Run `dev doctor` to diagnose, or `dev setup` to reinstall. ' +
    `Startup output is captured in ${logPath}.`
  );
}

/** Injectable boundaries for ensureAntfly — defaults hit the real system. */
export interface LifecycleDeps {
  isReady: (url: string) => Promise<boolean>;
  hasNative: () => boolean;
  startNative: () => Promise<void> | void;
  detectRuntime: () => ContainerRuntime | null;
  containerExists: (runtime: ContainerRuntime) => boolean;
  runCommand: (command: string) => void;
  waitForReady: (url: string) => Promise<void>;
  logger?: { info: (msg: string) => void };
}

export interface EnsureAntflyOptions {
  quiet?: boolean;
  deps?: Partial<LifecycleDeps>;
}

/**
 * Ensure Antfly is running, auto-starting if needed.
 * Priority: already running → native binary → container runtime → error.
 */
export async function ensureAntfly(options: EnsureAntflyOptions = {}): Promise<string> {
  const url = getAntflyUrl();
  const deps: LifecycleDeps = {
    isReady: isServerReady,
    hasNative: () => hasNativeBinary(),
    startNative: () => startAntflyProcess(),
    detectRuntime: () => detectContainerRuntime(),
    containerExists: (runtime) => containerExists(runtime),
    runCommand: (command) => {
      execSync(command, { stdio: 'pipe' });
    },
    waitForReady: (u) => waitForServer(u, deps.isReady),
    ...options.deps,
  };
  const info = (msg: string) => {
    if (options.quiet) return;
    deps.logger?.info(msg);
  };

  if (await deps.isReady(url)) {
    return url;
  }

  if (deps.hasNative()) {
    info('Starting Antfly server...');
    await deps.startNative();
    await deps.waitForReady(url);
    info(`Antfly running on ${url}`);
    return url;
  }

  const runtime = deps.detectRuntime();
  if (runtime) {
    if (deps.containerExists(runtime)) {
      info(`Starting Antfly container (${runtime})...`);
      deps.runCommand(containerStartCommand(runtime, ANTFLY_CONTAINER_NAME));
    } else {
      info(`Starting Antfly via ${runtime}...`);
      deps.runCommand(
        containerRunCommand(runtime, {
          name: ANTFLY_CONTAINER_NAME,
          image: ANTFLY_CONTAINER_IMAGE,
          port: ANTFLY_PORT,
        })
      );
    }
    await deps.waitForReady(url);
    info(`Antfly running on ${url}`);
    return url;
  }

  throw new Error(
    'Antfly is not installed. Run `dev setup` to install:\n' +
      '  brew install --cask antflydb/antfly/antfly'
  );
}

/**
 * Poll until the server responds, then return. On timeout, check for a port
 * conflict (the most common cause) before giving generic guidance.
 */
export async function waitForServer(
  url: string = getAntflyUrl(),
  isReady: (url: string) => Promise<boolean> = isServerReady
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < STARTUP_TIMEOUT_MS) {
    if (await isReady(url)) return;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  try {
    const lsof = execSync(`lsof -i :${ANTFLY_PORT} -t`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (lsof) {
      throw new Error(
        `Port ${ANTFLY_PORT} is already in use (pid: ${lsof}).\n` +
          `  Check: lsof -i :${ANTFLY_PORT}\n` +
          `  Or set: ANTFLY_URL=http://localhost:<other-port>/api/v1`
      );
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('Port')) throw e;
  }

  throw new Error(
    `Antfly server did not start within ${STARTUP_TIMEOUT_MS / 1000}s.\n` +
      `  Check the startup log: ${getAntflyLogPath()}\n` +
      `  Then: dev doctor`
  );
}

/** Antfly native binary version, or null when not installed. */
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
 * Validate a Termite model name before it reaches a child process.
 *
 * Names look like "BAAI/bge-small-en-v1.5" or "mxbai-embed-large-v1".
 * Rejecting anything else blocks shell metacharacters and option-like
 * values ("--models-dir=...") even though the exec calls below already use
 * argv arrays (defense-in-depth: the value also flows into container exec).
 */
export function assertValidModelName(model: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(model)) {
    throw new Error(
      `Invalid model name: ${JSON.stringify(model)}. ` +
        'Expected letters, digits, ".", "_", "-", "/" (e.g. "BAAI/bge-small-en-v1.5").'
    );
  }
}

/**
 * Pull a Termite embedding model (native binary), targeting the models dir
 * used by the running swarm server.
 */
export function pullModel(model: string): void {
  assertValidModelName(model);
  execFileSync('antfly', ['termite', 'pull', '--models-dir', getTermiteModelsDir(), model], {
    stdio: 'inherit',
  });
}

/** Pull a Termite model inside the container. */
export function pullModelContainer(runtime: ContainerRuntime, model: string): void {
  assertValidModelName(model);
  execFileSync(runtime, ['exec', ANTFLY_CONTAINER_NAME, '/antfly', 'termite', 'pull', model], {
    stdio: 'inherit',
  });
}

/** Check model presence in the server's models dir (native binary). */
export function hasModel(model: string): boolean {
  assertValidModelName(model);
  try {
    const output = execFileSync(
      'antfly',
      ['termite', 'list', '--models-dir', getTermiteModelsDir()],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return modelPresentInOutput(model, output);
  } catch {
    return false;
  }
}

/** Check model presence inside the container. */
export function hasModelContainer(runtime: ContainerRuntime, model: string): boolean {
  assertValidModelName(model);
  try {
    const output = execFileSync(
      runtime,
      ['exec', ANTFLY_CONTAINER_NAME, '/antfly', 'termite', 'list'],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return modelPresentInOutput(model, output);
  } catch {
    return false;
  }
}

/** Container runtime's total allocated memory in bytes (for setup warnings). */
export function getContainerMemoryBytes(runtime: ContainerRuntime): number | null {
  try {
    const output = execSync(`${runtime} info 2>&1`, { encoding: 'utf-8', timeout: 5000 });
    const match = output.match(/memTotal:\s*(\d+)/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

/**
 * Return true when the model name is present in `antfly termite list` output.
 *
 * Strategy (most-specific first):
 *   1. Full name exact match — "BAAI/bge-small-en-v1.5" appears verbatim.
 *   2. Short name word-boundary — "bge-small-en-v1.5" appears as a whole token
 *      (not as a suffix of a different model name).
 */
export function modelPresentInOutput(model: string, output: string): boolean {
  if (output.includes(model)) return true;

  const shortName = model.split('/').pop() ?? model;
  const escaped = shortName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w/-])${escaped}(?![\\w/-])`).test(output);
}
