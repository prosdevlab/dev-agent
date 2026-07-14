/**
 * Tests for the shared Antfly lifecycle module.
 *
 * This module consolidates three previously divergent copies of the
 * start/recover logic (CLI utils, MCP server bin, adapter registry).
 * Regression context: the MCP server's copy spawned Antfly with
 * stdio:'ignore' (startup failures were undiagnosable) and fell back to
 * Docker only (dead code on Podman machines), then crashed the whole MCP
 * server when both paths failed.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  antflyUnavailableMessage,
  assertValidModelName,
  buildSwarmArgs,
  containerRunCommand,
  containerStartCommand,
  detectContainerRuntime,
  ensureAntfly,
  getAntflyLogPath,
  modelPresentInOutput,
  startAntflyProcess,
} from '../lifecycle';

describe('buildSwarmArgs', () => {
  it('pins data-dir and all port flags so every caller starts an identical server', () => {
    const args = buildSwarmArgs('/home/user/.antfly');
    expect(args[0]).toBe('swarm');
    expect(args).toContain('--data-dir');
    expect(args[args.indexOf('--data-dir') + 1]).toBe('/home/user/.antfly');
    expect(args).toContain('--metadata-api');
    expect(args).toContain('--store-api');
    expect(args).toContain('--metadata-raft');
    expect(args).toContain('--store-raft');
    expect(args).toContain('--health-port');
  });
});

describe('getAntflyLogPath', () => {
  it('places the log inside the antfly data dir', () => {
    expect(getAntflyLogPath('/data/antfly')).toBe(join('/data/antfly', 'antfly.log'));
  });
});

describe('startAntflyProcess', () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('captures child stdout/stderr into the log file instead of discarding it', async () => {
    dir = mkdtempSync(join(tmpdir(), 'antfly-lifecycle-'));
    const logPath = join(dir, 'antfly.log');

    startAntflyProcess({
      command: process.execPath,
      args: ['-e', 'console.error("boom from child"); console.log("hello from child")'],
      logPath,
    });

    // Detached child writes asynchronously — poll briefly.
    const deadline = Date.now() + 5000;
    let content = '';
    while (Date.now() < deadline) {
      try {
        content = readFileSync(logPath, 'utf-8');
        if (content.includes('boom from child') && content.includes('hello from child')) break;
      } catch {
        // file not created yet
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(content).toContain('boom from child');
    expect(content).toContain('hello from child');
    // Header line marks each start attempt so repeated failures are separable.
    expect(content).toContain('[dev-agent] starting');
  });
});

describe('startAntflyProcess error path', () => {
  it('throws (and does not hang) when the spawn command is invalid', () => {
    const dir = mkdtempSync(join(tmpdir(), 'antfly-lifecycle-err-'));
    try {
      // Empty command makes spawn throw synchronously — the log fd must be
      // released via finally, not leaked (BackendGate retries init on every
      // failed tool call, so a leak here accumulates toward EMFILE).
      expect(() =>
        startAntflyProcess({ command: '', args: [], logPath: join(dir, 'antfly.log') })
      ).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('assertValidModelName', () => {
  it('accepts real Termite model names', () => {
    expect(() => assertValidModelName('BAAI/bge-small-en-v1.5')).not.toThrow();
    expect(() => assertValidModelName('mxbai-embed-large-v1')).not.toThrow();
  });

  it('rejects shell metacharacters and option-like names', () => {
    expect(() => assertValidModelName('x; rm -rf ~')).toThrow(/model name/i);
    expect(() => assertValidModelName('$(whoami)')).toThrow(/model name/i);
    expect(() => assertValidModelName('a && b')).toThrow(/model name/i);
    expect(() => assertValidModelName('--models-dir=/tmp/evil')).toThrow(/model name/i);
    expect(() => assertValidModelName('')).toThrow(/model name/i);
  });
});

describe('detectContainerRuntime', () => {
  it('prefers docker when available', () => {
    const probe = (cmd: string) => cmd.startsWith('docker');
    expect(detectContainerRuntime(probe)).toBe('docker');
  });

  it('falls back to podman when docker is unavailable', () => {
    const probe = (cmd: string) => cmd.startsWith('podman');
    expect(detectContainerRuntime(probe)).toBe('podman');
  });

  it('returns null when neither runtime responds', () => {
    expect(detectContainerRuntime(() => false)).toBe(null);
  });
});

describe('container command builders', () => {
  it('uses the detected runtime binary for start', () => {
    expect(containerStartCommand('podman', 'dev-agent-antfly')).toBe(
      'podman start dev-agent-antfly'
    );
    expect(containerStartCommand('docker', 'dev-agent-antfly')).toBe(
      'docker start dev-agent-antfly'
    );
  });

  it('uses the detected runtime binary for run', () => {
    const cmd = containerRunCommand('podman', {
      name: 'dev-agent-antfly',
      image: 'ghcr.io/antflydb/antfly:latest',
      port: 18080,
    });
    expect(cmd.startsWith('podman run ')).toBe(true);
    expect(cmd).toContain('--name dev-agent-antfly');
    expect(cmd).toContain('-p 18080:8080');
    expect(cmd).toContain('ghcr.io/antflydb/antfly:latest');
  });
});

describe('ensureAntfly orchestration', () => {
  const URL = 'http://localhost:18080/api/v1';

  it('returns immediately when the server is already reachable', async () => {
    const startNative = vi.fn();
    const url = await ensureAntfly({
      quiet: true,
      deps: {
        isReady: async () => true,
        startNative,
      },
    });
    expect(url).toBe(URL);
    expect(startNative).not.toHaveBeenCalled();
  });

  it('starts the native binary when installed and waits for readiness', async () => {
    let started = false;
    const url = await ensureAntfly({
      quiet: true,
      deps: {
        isReady: async () => started,
        hasNative: () => true,
        startNative: async () => {
          started = true;
        },
        waitForReady: async () => {},
      },
    });
    expect(url).toBe(URL);
    expect(started).toBe(true);
  });

  it('falls back to podman when native is missing and docker is unavailable', async () => {
    const commands: string[] = [];
    let started = false;
    await ensureAntfly({
      quiet: true,
      deps: {
        isReady: async () => started,
        hasNative: () => false,
        detectRuntime: () => 'podman',
        containerExists: () => true,
        runCommand: (cmd: string) => {
          commands.push(cmd);
          started = true;
        },
        waitForReady: async () => {},
      },
    });
    expect(commands).toEqual(['podman start dev-agent-antfly']);
  });

  it('creates a new container when none exists', async () => {
    const commands: string[] = [];
    await ensureAntfly({
      quiet: true,
      deps: {
        isReady: async () => false,
        hasNative: () => false,
        detectRuntime: () => 'podman',
        containerExists: () => false,
        runCommand: (cmd: string) => {
          commands.push(cmd);
        },
        waitForReady: async () => {},
      },
    });
    expect(commands).toHaveLength(1);
    expect(commands[0].startsWith('podman run ')).toBe(true);
  });

  it('throws actionable guidance when nothing can start Antfly', async () => {
    await expect(
      ensureAntfly({
        quiet: true,
        deps: {
          isReady: async () => false,
          hasNative: () => false,
          detectRuntime: () => null,
        },
      })
    ).rejects.toThrow(/dev setup/);
  });
});

describe('antflyUnavailableMessage', () => {
  it('points at the doctor command and the captured log', () => {
    const msg = antflyUnavailableMessage('/home/user/.antfly/antfly.log');
    expect(msg).toContain('dev doctor');
    expect(msg).toContain('/home/user/.antfly/antfly.log');
  });
});

// Ported from packages/cli/src/utils/__tests__/antfly.test.ts, now importing
// the real implementation instead of a mirrored copy.
describe('modelPresentInOutput', () => {
  const FULL_NAME = 'BAAI/bge-small-en-v1.5';

  const PRESENT_OUTPUT = `Local models in /Users/dev/.antfly/models:

NAME                    TYPE      SIZE      VARIANTS  SOURCE
BAAI/bge-small-en-v1.5  embedder  127.8 MB            BAAI/bge-small-en-v1.5
`;

  const EMPTY_OUTPUT = `Local models in /Users/dev/.antfly/models:

NAME  TYPE  SIZE  VARIANTS  SOURCE
No models found locally.
`;

  const OTHER_MODEL_OUTPUT = `Local models in /Users/dev/.antfly/models:

NAME                          TYPE      SIZE      VARIANTS  SOURCE
vendor/other-bge-small-en-v1.5  embedder  200.0 MB            vendor/other-bge-small-en-v1.5
`;

  it('returns true when full model name is present', () => {
    expect(modelPresentInOutput(FULL_NAME, PRESENT_OUTPUT)).toBe(true);
  });

  it('returns false when models directory is empty', () => {
    expect(modelPresentInOutput(FULL_NAME, EMPTY_OUTPUT)).toBe(false);
  });

  it('returns false when a different model shares the short name as a suffix', () => {
    expect(modelPresentInOutput(FULL_NAME, OTHER_MODEL_OUTPUT)).toBe(false);
  });

  it('returns true when only the short name is present as a standalone token', () => {
    expect(modelPresentInOutput(FULL_NAME, 'bge-small-en-v1.5  embedder  127 MB')).toBe(true);
  });
});
