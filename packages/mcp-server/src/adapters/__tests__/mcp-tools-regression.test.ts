/**
 * MCP Tools Regression — verifies exactly 5 built-in adapters.
 *
 * Health was merged into Status (dev_status section="health").
 * This test catches accidental re-introduction of removed adapters.
 */

import { describe, expect, it } from 'vitest';
import * as builtIn from '../built-in/index.js';

const adapterNames = Object.keys(builtIn).filter((k) => k.endsWith('Adapter'));

describe('MCP tools regression', () => {
  it('barrel exports exactly 5 adapter classes', () => {
    expect(adapterNames).toHaveLength(5);
  });

  it.each(['InspectAdapter', 'MapAdapter', 'RefsAdapter', 'SearchAdapter', 'StatusAdapter'])(
    'exports %s',
    (name) => {
      expect(adapterNames).toContain(name);
    }
  );

  it.each(['HealthAdapter', 'HistoryAdapter', 'GitHubAdapter', 'PlanAdapter', 'ExploreAdapter'])(
    'does NOT export removed %s',
    (name) => {
      expect(adapterNames).not.toContain(name);
    }
  );
});
