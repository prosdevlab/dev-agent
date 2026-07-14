/**
 * BackendGate — decouples MCP handshake from backend readiness.
 *
 * The MCP server must complete its stdio handshake quickly even when the
 * Antfly backend is down or the index needs a long catchup. The gate wraps
 * every tool adapter: the first tool call waits for backend initialization;
 * a failed initialization becomes a legible per-tool error (never a process
 * exit) and is retried on the next call so the server self-heals once the
 * backend is reachable again.
 */

import { antflyUnavailableMessage } from '@prosdevlab/dev-agent-core';
import { ToolAdapter } from '../adapters/tool-adapter';
import type {
  AdapterContext,
  AdapterMetadata,
  ToolDefinition,
  ToolExecutionContext,
  ToolResult,
} from '../adapters/types';

export class BackendGate {
  private current: Promise<void> | null = null;
  private ready = false;

  constructor(private readonly init: () => Promise<void>) {}

  /**
   * Kick off initialization in the background. Failures are logged by the
   * caller's init function and surfaced per tool call — never thrown here.
   */
  start(): void {
    void this.ensureReady().catch(() => {
      // Swallowed: the failure is stored via `current` reset and re-thrown
      // to the tool call that next awaits ensureReady().
    });
  }

  /** Resolve when the backend is ready; reject with the init error if not. */
  async ensureReady(): Promise<void> {
    if (this.ready) return;
    if (!this.current) {
      this.current = this.init().then(
        () => {
          this.ready = true;
        },
        (error) => {
          // Reset so the next call retries initialization (self-healing).
          this.current = null;
          throw error;
        }
      );
    }
    return this.current;
  }

  /** Wrap an adapter so its execution waits on (and reports) backend state. */
  wrap(adapter: ToolAdapter): ToolAdapter {
    return new GatedToolAdapter(this, adapter);
  }
}

class GatedToolAdapter extends ToolAdapter {
  readonly metadata: AdapterMetadata;

  constructor(
    private readonly gate: BackendGate,
    private readonly inner: ToolAdapter
  ) {
    super();
    this.metadata = inner.metadata;
    if (inner.validate) this.validate = inner.validate.bind(inner);
    if (inner.estimateTokens) this.estimateTokens = inner.estimateTokens.bind(inner);
  }

  getToolDefinition(): ToolDefinition {
    return this.inner.getToolDefinition();
  }

  initialize(context: AdapterContext): Promise<void> {
    return this.inner.initialize(context);
  }

  async shutdown(): Promise<void> {
    await this.inner.shutdown?.();
  }

  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
    try {
      await this.gate.ensureReady();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      context.logger.error('Backend initialization failed', { error: detail });
      return {
        success: false,
        error: {
          code: 'BACKEND_UNAVAILABLE',
          message: `${antflyUnavailableMessage()} (${detail})`,
          recoverable: true,
          suggestion: 'Run `dev doctor` to diagnose, then retry this tool call.',
        },
      };
    }
    return this.inner.execute(args, context);
  }
}
