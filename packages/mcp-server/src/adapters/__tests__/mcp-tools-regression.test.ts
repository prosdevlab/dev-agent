/**
 * MCP Tools Regression — verifies exactly 6 built-in adapters survive Phase 2 cleanup.
 *
 * This test catches accidental re-introduction of removed adapters (History, GitHub,
 * Plan, Explore) and ensures no adapters are silently dropped.
 */

import { describe, expect, it } from 'vitest';
import * as builtIn from '../built-in/index.js';

const adapterNames = Object.keys(builtIn).filter((k) => k.endsWith('Adapter'));

describe('MCP tools regression (post Phase 2)', () => {
  it('barrel exports exactly 6 adapter classes', () => {
    expect(adapterNames).toHaveLength(6);
  });

  it.each([
    'HealthAdapter',
    'InspectAdapter',
    'MapAdapter',
    'RefsAdapter',
    'SearchAdapter',
    'StatusAdapter',
  ])('exports %s', (name) => {
    expect(adapterNames).toContain(name);
  });

  it.each(['HistoryAdapter', 'GitHubAdapter', 'PlanAdapter', 'ExploreAdapter'])(
    'does NOT export removed %s',
    (name) => {
      expect(adapterNames).not.toContain(name);
    }
  );
});
