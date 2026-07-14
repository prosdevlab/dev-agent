/**
 * `dev doctor` check runner — pure logic with injected system probes.
 *
 * Health checks previously lived only in the dev_status MCP tool, which is
 * unreachable exactly when the search backend is broken. This is the CLI
 * escape hatch: it must work with nothing else running.
 */

import type { ContainerRuntime } from '@prosdevlab/dev-agent-core';

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
  hint?: string;
}

export interface DoctorProbes {
  /** Native binary version, or null when not installed. */
  nativeVersion: () => string | null;
  /** Detected container runtime, or null. */
  containerRuntime: () => ContainerRuntime | null;
  /** Is the Antfly HTTP API responding? */
  serverReady: () => Promise<boolean>;
  /** PID(s) holding the Antfly port, or null when free. */
  portOwner: () => string | null;
  /** Is the embedding model present in the server's models dir? */
  modelPresent: () => boolean;
  /** Does an index exist for the current repository? */
  indexExists: () => Promise<boolean>;
  /** Path to the captured Antfly startup log. */
  logPath: () => string;
}

export async function runDoctorChecks(probes: DoctorProbes): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  const version = probes.nativeVersion();
  const runtime = probes.containerRuntime();

  if (version) {
    checks.push({
      name: 'Antfly installed',
      ok: true,
      detail: `native binary (${version})`,
    });
  } else if (runtime) {
    checks.push({
      name: 'Antfly installed',
      ok: true,
      detail: `container runtime available (${runtime})`,
    });
  } else {
    checks.push({
      name: 'Antfly installed',
      ok: false,
      detail: 'no native binary and no container runtime (docker/podman) found',
      hint: 'Run `dev setup` to install Antfly',
    });
  }

  const ready = await probes.serverReady();
  if (ready) {
    checks.push({ name: 'Antfly server', ok: true, detail: 'reachable' });
  } else {
    const owner = probes.portOwner();
    if (owner) {
      checks.push({
        name: 'Antfly server',
        ok: false,
        detail: `not responding, but the port is held by another process (pid: ${owner})`,
        hint: 'Free the port or set ANTFLY_URL to a different port, then retry',
      });
    } else {
      checks.push({
        name: 'Antfly server',
        ok: false,
        detail: 'not running',
        hint: `Run \`dev setup\` to start it; startup output is captured in ${probes.logPath()}`,
      });
    }
  }

  // Model presence can only be probed when something can run `antfly termite list`.
  if (version || runtime) {
    const model = probes.modelPresent();
    checks.push(
      model
        ? { name: 'Embedding model', ok: true, detail: 'present' }
        : {
            name: 'Embedding model',
            ok: false,
            detail: 'not found in the server models directory',
            hint: 'Run `dev setup` to pull the embedding model',
          }
    );
  }

  const hasIndex = await probes.indexExists();
  checks.push(
    hasIndex
      ? { name: 'Repository index', ok: true, detail: 'present' }
      : {
          name: 'Repository index',
          ok: false,
          detail: 'no index found for this repository',
          hint: 'Run `dev index` to build it',
        }
  );

  return checks;
}
