/**
 * Tests for the `dev doctor` check runner.
 *
 * Context: health checks previously lived only in the dev_status MCP tool —
 * useless when the MCP server itself is down because Antfly won't start.
 * `dev doctor` is the CLI escape hatch; runDoctorChecks is its pure core
 * with all system probes injected.
 */

import { describe, expect, it } from 'vitest';
import { type DoctorProbes, runDoctorChecks } from '../doctor.js';

function healthyProbes(overrides: Partial<DoctorProbes> = {}): DoctorProbes {
  return {
    nativeVersion: () => 'antfly 1.4.0',
    containerRuntime: () => null,
    serverReady: async () => true,
    portOwner: () => null,
    modelPresent: () => true,
    indexExists: async () => true,
    logPath: () => '/home/user/.antfly/antfly.log',
    ...overrides,
  };
}

describe('runDoctorChecks', () => {
  it('reports all checks ok on a healthy system', async () => {
    const checks = await runDoctorChecks(healthyProbes());

    expect(checks.length).toBeGreaterThanOrEqual(4);
    expect(checks.every((c) => c.ok)).toBe(true);
  });

  it('fails the install check with setup guidance when nothing is installed', async () => {
    const checks = await runDoctorChecks(
      healthyProbes({
        nativeVersion: () => null,
        containerRuntime: () => null,
        serverReady: async () => false,
        modelPresent: () => false,
      })
    );

    const install = checks.find((c) => c.name.includes('installed'));
    expect(install?.ok).toBe(false);
    expect(install?.hint).toContain('dev setup');
  });

  it('treats a container runtime as a valid install when the binary is missing', async () => {
    const checks = await runDoctorChecks(
      healthyProbes({
        nativeVersion: () => null,
        containerRuntime: () => 'podman',
      })
    );

    const install = checks.find((c) => c.name.includes('installed'));
    expect(install?.ok).toBe(true);
    expect(install?.detail).toContain('podman');
  });

  it('surfaces a port conflict when the server is down but the port is taken', async () => {
    const checks = await runDoctorChecks(
      healthyProbes({
        serverReady: async () => false,
        portOwner: () => '12345',
      })
    );

    const server = checks.find((c) => c.name.includes('server'));
    expect(server?.ok).toBe(false);
    expect(server?.detail).toContain('12345');
  });

  it('points at the startup log when the server is down with no port conflict', async () => {
    const checks = await runDoctorChecks(
      healthyProbes({
        serverReady: async () => false,
      })
    );

    const server = checks.find((c) => c.name.includes('server'));
    expect(server?.ok).toBe(false);
    expect(server?.hint).toContain('/home/user/.antfly/antfly.log');
  });

  it('fails the index check with `dev index` guidance when no index exists', async () => {
    const checks = await runDoctorChecks(
      healthyProbes({
        indexExists: async () => false,
      })
    );

    const index = checks.find((c) => c.name.includes('index'));
    expect(index?.ok).toBe(false);
    expect(index?.hint).toContain('dev index');
  });

  it('skips the model check when neither binary nor runtime can list models', async () => {
    const checks = await runDoctorChecks(
      healthyProbes({
        nativeVersion: () => null,
        containerRuntime: () => null,
      })
    );

    const model = checks.find((c) => c.name.includes('model'));
    expect(model).toBeUndefined();
  });
});
