/**
 * Health Service
 *
 * Shared service for component health checks.
 * Used by both MCP health adapter and Dashboard health API.
 */

import type { Logger } from '@prosdevlab/kero';
import type { RepositoryIndexer } from '../indexer/index.js';
import type { VectorStorage } from '../vector/index.js';

export interface ComponentHealth {
  status: 'ok' | 'warning' | 'error';
  message?: string;
  details?: Record<string, unknown>;
}

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: Date;
  checks: {
    indexer: ComponentHealth;
    vectorStorage: ComponentHealth;
  };
}

export interface HealthServiceConfig {
  repositoryPath: string;
  logger?: Logger;
}

/**
 * Config types for component factories
 */
export interface IndexerFactoryConfig {
  repositoryPath: string;
  vectorStorePath: string;
  logger?: Logger;
}

export interface VectorStorageFactoryConfig {
  storePath: string;
  embeddingModel: string;
  dimension: number;
}

/**
 * Factory functions for creating component instances
 */
export interface HealthServiceFactories {
  createIndexer?: (config: IndexerFactoryConfig) => Promise<RepositoryIndexer>;
  createVectorStorage?: (config: VectorStorageFactoryConfig) => Promise<VectorStorage>;
}

/**
 * Service for checking component health
 *
 * Runs health checks on indexer and vector storage.
 * Returns structured health information.
 */
export class HealthService {
  private repositoryPath: string;
  private logger?: Logger;
  private factories: Required<HealthServiceFactories>;

  constructor(config: HealthServiceConfig, factories?: HealthServiceFactories) {
    this.repositoryPath = config.repositoryPath;
    this.logger = config.logger;

    // Use provided factories or defaults
    this.factories = {
      createIndexer: factories?.createIndexer || this.defaultIndexerFactory.bind(this),
      createVectorStorage:
        factories?.createVectorStorage || this.defaultVectorStorageFactory.bind(this),
    };
  }

  /**
   * Default factory implementations
   */
  private async defaultIndexerFactory(config: IndexerFactoryConfig): Promise<RepositoryIndexer> {
    const { RepositoryIndexer: Indexer } = await import('../indexer/index.js');
    return new Indexer({
      repositoryPath: config.repositoryPath,
      vectorStorePath: config.vectorStorePath,
      logger: config.logger,
    });
  }

  private async defaultVectorStorageFactory(
    config: VectorStorageFactoryConfig
  ): Promise<VectorStorage> {
    const { VectorStorage: Storage } = await import('../vector/index.js');
    return new Storage({
      storePath: config.storePath,
      embeddingModel: config.embeddingModel,
      dimension: config.dimension,
    });
  }

  /**
   * Run comprehensive health checks
   *
   * Checks all components in parallel for performance.
   *
   * @returns Health check results
   */
  async check(): Promise<HealthCheckResult> {
    const { getStoragePath, getStorageFilePaths } = await import('../storage/path.js');
    const storagePath = await getStoragePath(this.repositoryPath);
    const filePaths = getStorageFilePaths(storagePath);

    // Run checks in parallel
    const [indexer, vectorStorage] = await Promise.all([
      this.checkIndexer(filePaths),
      this.checkVectorStorage(filePaths),
    ]);

    // Determine overall status
    const hasError = [indexer, vectorStorage].some((c) => c.status === 'error');
    const hasWarning = [indexer, vectorStorage].some((c) => c.status === 'warning');

    const overallStatus = hasError ? 'unhealthy' : hasWarning ? 'degraded' : 'healthy';

    return {
      status: overallStatus,
      timestamp: new Date(),
      checks: {
        indexer,
        vectorStorage,
      },
    };
  }

  private async checkIndexer(filePaths: {
    vectors: string;
    [key: string]: string;
  }): Promise<ComponentHealth> {
    try {
      const indexer = await this.factories.createIndexer({
        repositoryPath: this.repositoryPath,
        vectorStorePath: filePaths.vectors,
        logger: this.logger,
      });

      await indexer.initialize();
      const stats = await indexer.getStats();
      await indexer.close();

      if (!stats) {
        return {
          status: 'error',
          message: 'Repository not indexed',
        };
      }

      return {
        status: 'ok',
        details: {
          totalFiles: stats.filesScanned,
          totalDocuments: stats.documentsIndexed,
          lastIndexed: stats.endTime.toISOString(),
        },
      };
    } catch (error) {
      return {
        status: 'error',
        message: error instanceof Error ? error.message : 'Indexer check failed',
      };
    }
  }

  private async checkVectorStorage(filePaths: {
    vectors: string;
    [key: string]: string;
  }): Promise<ComponentHealth> {
    try {
      const vectorStorage = await this.factories.createVectorStorage({
        storePath: filePaths.vectors,
        embeddingModel: 'Xenova/all-MiniLM-L6-v2',
        dimension: 384,
      });

      await vectorStorage.initialize();
      await vectorStorage.close();

      return {
        status: 'ok',
        message: 'Vector storage operational',
      };
    } catch (error) {
      return {
        status: 'error',
        message: error instanceof Error ? error.message : 'Vector storage check failed',
      };
    }
  }
}
