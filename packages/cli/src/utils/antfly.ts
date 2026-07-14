/**
 * Antfly server lifecycle — re-exported from core.
 *
 * The implementation lives in @prosdevlab/dev-agent-core (antfly/lifecycle)
 * so the CLI, the MCP server entry point, and the adapter registry share one
 * copy. This file remains as the CLI-local import path.
 */

export {
  ANTFLY_CONTAINER_IMAGE,
  ANTFLY_CONTAINER_NAME,
  antflyUnavailableMessage,
  type ContainerRuntime,
  containerExists,
  detectContainerRuntime,
  ensureAntfly,
  getAntflyDataDir,
  getAntflyLogPath,
  getAntflyUrl,
  getContainerMemoryBytes,
  getNativeVersion,
  hasModel,
  hasModelContainer,
  hasNativeBinary,
  isServerReady,
  pullModel,
  pullModelContainer,
} from '@prosdevlab/dev-agent-core';
