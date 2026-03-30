/**
 * Status Adapter
 * Provides repository status, indexing statistics, and health checks
 * Queries Antfly directly for vector stats and reports watcher snapshot age.
 */

import * as fs from 'node:fs';
import type { VectorStorage } from '@prosdevlab/dev-agent-core';
import { estimateTokensForText } from '../../formatters/utils';
import { StatusArgsSchema } from '../../schemas/index.js';
import { ToolAdapter } from '../tool-adapter';
import type { AdapterContext, ToolDefinition, ToolExecutionContext, ToolResult } from '../types';
import { validateArgs } from '../validation.js';

/**
 * Status section types
 */
export type StatusSection = 'summary' | 'repo' | 'indexes' | 'health';

/**
 * Status adapter configuration
 */
export interface StatusAdapterConfig {
  /**
   * Vector storage for direct Antfly access
   */
  vectorStorage: VectorStorage;

  /**
   * Repository path
   */
  repositoryPath: string;

  /**
   * Path to the watcher snapshot file (for reporting snapshot age)
   */
  watcherSnapshotPath: string;

  /**
   * Default section to display
   */
  defaultSection?: StatusSection;
}

/**
 * Status Adapter
 * Implements the dev_status tool for repository status and health checks
 */
export class StatusAdapter extends ToolAdapter {
  readonly metadata = {
    name: 'status-adapter',
    version: '1.0.0',
    description: 'Repository status and health monitoring adapter',
    author: 'Dev-Agent Team',
  };

  private vectorStorage: VectorStorage;
  private repositoryPath: string;
  private watcherSnapshotPath: string;
  private defaultSection: StatusSection;

  constructor(config: StatusAdapterConfig) {
    super();
    this.vectorStorage = config.vectorStorage;
    this.repositoryPath = config.repositoryPath;
    this.watcherSnapshotPath = config.watcherSnapshotPath;
    this.defaultSection = config.defaultSection ?? 'summary';
  }

  async initialize(context: AdapterContext): Promise<void> {
    context.logger.info('StatusAdapter initialized', {
      repositoryPath: this.repositoryPath,
      defaultSection: this.defaultSection,
    });
  }

  getToolDefinition(): ToolDefinition {
    return {
      name: 'dev_status',
      description: 'Get repository indexing status, configuration, and health checks',
      inputSchema: {
        type: 'object',
        properties: {
          section: {
            type: 'string',
            enum: ['summary', 'repo', 'indexes', 'health'],
            description:
              'Which section to display: "summary" (overview), "repo" (repository details), "indexes" (vector storage), "health" (system checks)',
            default: this.defaultSection,
          },
          format: {
            type: 'string',
            enum: ['compact', 'verbose'],
            description:
              'Output format: "compact" for brief info (default), "verbose" for full details',
            default: 'compact',
          },
        },
        required: [],
      },
    };
  }

  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
    // Validate args with Zod (no type assertions!)
    const validation = validateArgs(StatusArgsSchema, args);
    if (!validation.success) {
      return validation.error;
    }

    const { section, format } = validation.data;

    try {
      const startTime = Date.now();
      context.logger.debug('Executing status check', { section, format });

      // Generate status content based on section
      const content = await this.generateStatus(section, format, context);

      const duration_ms = Date.now() - startTime;
      const tokens = estimateTokensForText(content);

      context.logger.info('Status check completed', { section, format, duration_ms });

      // Return formatted content (MCP will wrap in content blocks)
      return {
        success: true,
        data: content,
        metadata: {
          tokens,
          duration_ms,
          timestamp: new Date().toISOString(),
          cached: false,
        },
      };
    } catch (error) {
      context.logger.error('Status check failed', { error });
      return {
        success: false,
        error: {
          code: 'STATUS_FAILED',
          message: error instanceof Error ? error.message : 'Unknown error',
          details: error,
        },
      };
    }
  }

  /**
   * Generate status content for a specific section
   */
  private async generateStatus(
    section: StatusSection,
    format: string,
    _context: ToolExecutionContext
  ): Promise<string> {
    switch (section) {
      case 'summary':
        return this.generateSummary(format);
      case 'repo':
        return this.generateRepoStatus(format);
      case 'indexes':
        return this.generateIndexesStatus(format);
      case 'health':
        return this.generateHealthStatus(format);
      default:
        throw new Error(`Unknown section: ${section}`);
    }
  }

  /**
   * Generate summary (overview of all sections)
   */
  private async generateSummary(_format: string): Promise<string> {
    const stats = await this.vectorStorage.getStats();
    const snapshotAge = await this.getSnapshotAge();

    const lines: string[] = ['## Dev-Agent Status', ''];
    lines.push(`**Repository:** ${this.repositoryPath}`);
    lines.push(
      `**Documents:** ${stats.totalDocuments > 0 ? stats.totalDocuments.toLocaleString() : 'Not indexed'}`
    );

    if (snapshotAge) {
      lines.push(`**Last Updated:** ${this.formatTimeAgo(snapshotAge)}`);
      lines.push('**Auto-index:** Active');
    } else {
      lines.push('**Auto-index:** Not active — run `dev index`');
    }
    lines.push('');

    const health = await this.checkHealth();
    const healthIcon = health.every((c) => c.status === 'ok') ? 'OK' : 'WARNING';
    lines.push(
      `**Health:** ${healthIcon} (${health.filter((c) => c.status === 'ok').length}/${health.length} checks passed)`
    );

    return lines.join('\n');
  }

  /**
   * Generate repository status
   */
  private async generateRepoStatus(_format: string): Promise<string> {
    const stats = await this.vectorStorage.getStats();

    const lines: string[] = ['## Repository Index', ''];

    if (stats.totalDocuments === 0) {
      lines.push('**Status:** Not indexed');
      lines.push('');
      lines.push('Run `dev index` to index your repository');
      return lines.join('\n');
    }

    lines.push(`**Path:** ${this.repositoryPath}`);
    lines.push(`**Documents:** ${stats.totalDocuments.toLocaleString()}`);
    lines.push(`**Storage:** Antfly`);
    lines.push(`**Model:** ${stats.modelName} (${stats.dimension}-dim)`);
    lines.push(`**Size:** ${this.formatBytes(stats.storageSize)}`);

    return lines.join('\n');
  }

  /**
   * Generate indexes status
   */
  private async generateIndexesStatus(_format: string): Promise<string> {
    const stats = await this.vectorStorage.getStats();
    const snapshotAge = await this.getSnapshotAge();

    const lines: string[] = ['## Vector Index', ''];
    lines.push('### Code Index');
    if (stats.totalDocuments > 0) {
      lines.push('- **Storage:** Antfly');
      lines.push(`- **Documents:** ${stats.totalDocuments.toLocaleString()}`);
      lines.push(`- **Model:** ${stats.modelName} (${stats.dimension}-dim)`);
      lines.push(`- **Size:** ${this.formatBytes(stats.storageSize)}`);
    } else {
      lines.push('- **Status:** Not indexed');
      lines.push('- Run `dev index` to index your repository');
    }

    lines.push('');
    lines.push('### Watcher');
    if (snapshotAge !== null) {
      lines.push(`- **Last Snapshot:** ${this.formatTimeAgo(snapshotAge)}`);
      lines.push('- **Auto-index:** Active (file watcher running)');
    } else {
      lines.push('- **Snapshot:** Not found — run `dev index` to create');
    }

    return lines.join('\n');
  }

  /**
   * Generate health status
   */
  private async generateHealthStatus(format: string): Promise<string> {
    const checks = await this.checkHealth();

    const lines: string[] = ['## Health Checks', ''];

    for (const check of checks) {
      const icon = check.status === 'ok' ? '✅' : check.status === 'warning' ? '⚠️' : '❌';
      lines.push(`${icon} **${check.name}:** ${check.message}`);
      if (format === 'verbose' && check.details) {
        lines.push(`   ${check.details}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Get the mtime of the watcher snapshot file, or null if it doesn't exist.
   */
  private async getSnapshotAge(): Promise<Date | null> {
    try {
      const stat = await fs.promises.stat(this.watcherSnapshotPath);
      return stat.mtime;
    } catch {
      return null;
    }
  }

  /**
   * Check system health
   */
  private async checkHealth(): Promise<
    Array<{ name: string; status: 'ok' | 'warning' | 'error'; message: string; details?: string }>
  > {
    const checks: Array<{
      name: string;
      status: 'ok' | 'warning' | 'error';
      message: string;
      details?: string;
    }> = [];

    // Repository access
    try {
      await fs.promises.access(this.repositoryPath, fs.constants.R_OK);
      checks.push({
        name: 'Repository Access',
        status: 'ok',
        message: 'Can read source files',
      });
    } catch {
      checks.push({
        name: 'Repository Access',
        status: 'error',
        message: 'Cannot access repository',
        details: `Path: ${this.repositoryPath}`,
      });
    }

    // Antfly connectivity
    try {
      const stats = await this.vectorStorage.getStats();
      checks.push({
        name: 'Antfly',
        status: 'ok',
        message: 'Connected and responding',
        details: `${stats.totalDocuments} documents indexed`,
      });
    } catch {
      checks.push({
        name: 'Antfly',
        status: 'error',
        message: 'Not reachable — run `dev setup`',
      });
    }

    return checks;
  }

  /**
   * Format bytes to human-readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
  }

  /**
   * Format time ago (e.g., "2 hours ago")
   */
  private formatTimeAgo(date: Date | string): string {
    const now = new Date();
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    const seconds = Math.floor((now.getTime() - dateObj.getTime()) / 1000);

    if (seconds < 60) return `${seconds} seconds ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
    const months = Math.floor(days / 30);
    return `${months} month${months === 1 ? '' : 's'} ago`;
  }

  estimateTokens(args: Record<string, unknown>): number {
    const { section = this.defaultSection, format = 'compact' } = args;

    // Rough estimates based on section and format
    if (format === 'verbose') {
      return section === 'summary' ? 800 : 500;
    }

    // Compact estimates
    return section === 'summary' ? 200 : 150;
  }
}
