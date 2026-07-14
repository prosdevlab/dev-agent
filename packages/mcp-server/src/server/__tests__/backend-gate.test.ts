/**
 * Tests for BackendGate — graceful MCP startup when the Antfly backend is
 * down or slow.
 *
 * Regression context: the MCP server used to run Antfly auto-start, indexer
 * init, and watcher catchup BEFORE completing the MCP handshake. A cold or
 * unstartable Antfly killed the whole server with a bare -32000 "connection
 * closed" and no diagnosable trail. The gate lets the server start
 * immediately and turns backend failures into legible per-tool errors.
 */

import { describe, expect, it, vi } from 'vitest';
import { MockAdapter } from '../../adapters/__tests__/mock-adapter';
import type { ToolExecutionContext } from '../../adapters/types';
import { BackendGate } from '../backend-gate';

function makeContext(): ToolExecutionContext {
  return {
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    config: {
      repositoryPath: '/test/repo',
    },
  };
}

describe('BackendGate', () => {
  it('passes tool calls through once the backend initialized successfully', async () => {
    const gate = new BackendGate(async () => {});
    const wrapped = gate.wrap(new MockAdapter());

    const result = await wrapped.execute({ message: 'hi' }, makeContext());

    expect(result.success).toBe(true);
  });

  it('makes the first tool call wait for a pending initialization', async () => {
    let release: () => void = () => {};
    const initDone = new Promise<void>((r) => {
      release = r;
    });
    const gate = new BackendGate(() => initDone);
    const wrapped = gate.wrap(new MockAdapter());
    gate.start();

    const pending = wrapped.execute({ message: 'hi' }, makeContext());
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);

    release();
    const result = await pending;
    expect(result.success).toBe(true);
  });

  it('returns a legible error result instead of crashing when init fails', async () => {
    const gate = new BackendGate(async () => {
      throw new Error('fetch failed');
    });
    const wrapped = gate.wrap(new MockAdapter());
    gate.start();

    const result = await wrapped.execute({ message: 'hi' }, makeContext());

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Antfly');
    expect(result.error?.message).toContain('dev doctor');
    expect(result.error?.recoverable).toBe(true);
  });

  it('retries initialization on the next call after a failure (self-healing)', async () => {
    let attempts = 0;
    const gate = new BackendGate(async () => {
      attempts++;
      if (attempts === 1) throw new Error('fetch failed');
    });
    const wrapped = gate.wrap(new MockAdapter());

    const first = await wrapped.execute({ message: 'hi' }, makeContext());
    expect(first.success).toBe(false);

    const second = await wrapped.execute({ message: 'hi' }, makeContext());
    expect(second.success).toBe(true);
    expect(attempts).toBe(2);
  });

  it('initializes only once across concurrent calls and repeated successes', async () => {
    const init = vi.fn(async () => {});
    const gate = new BackendGate(init);
    const wrapped = gate.wrap(new MockAdapter());

    await Promise.all([
      wrapped.execute({ message: 'a' }, makeContext()),
      wrapped.execute({ message: 'b' }, makeContext()),
    ]);
    await wrapped.execute({ message: 'c' }, makeContext());

    expect(init).toHaveBeenCalledTimes(1);
  });

  it('start() kicks off init in the background without throwing on failure', async () => {
    const gate = new BackendGate(async () => {
      throw new Error('nope');
    });
    expect(() => gate.start()).not.toThrow();
    // Allow the rejected promise to settle — must not become an unhandled rejection.
    await new Promise((r) => setTimeout(r, 10));
  });

  it('delegates tool definition and metadata to the inner adapter', () => {
    const gate = new BackendGate(async () => {});
    const inner = new MockAdapter('my_tool');
    const wrapped = gate.wrap(inner);

    expect(wrapped.getToolDefinition().name).toBe('my_tool');
    expect(wrapped.metadata.name).toBe(inner.metadata.name);
  });
});
