/**
 * Schema validation tests
 *
 * These tests validate schemas in isolation (pure functions, no mocks needed)
 * Adapter tests focus on business logic, not validation
 */

import { describe, expect, it } from 'vitest';
import {
  InspectArgsSchema,
  MapArgsSchema,
  RefsArgsSchema,
  SearchArgsSchema,
  StatusArgsSchema,
} from '../index';

describe('InspectArgsSchema', () => {
  it('should validate valid input', () => {
    const result = InspectArgsSchema.safeParse({
      filePath: 'src/auth/token.ts',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10); // default
    }
  });

  it('should apply defaults', () => {
    const result = InspectArgsSchema.safeParse({
      filePath: 'test.ts',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        limit: 10,
        format: 'compact',
      });
    }
  });

  it('should accept json format', () => {
    const result = InspectArgsSchema.safeParse({
      filePath: 'test.ts',
      format: 'json',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.format).toBe('json');
    }
  });

  it('should reject empty filePath', () => {
    const result = InspectArgsSchema.safeParse({
      filePath: '',
    });

    expect(result.success).toBe(false);
  });

  it('should reject out-of-range limit', () => {
    const result = InspectArgsSchema.safeParse({
      filePath: 'test.ts',
      limit: 200,
    });

    expect(result.success).toBe(false);
  });

  it('should reject unknown properties', () => {
    const result = InspectArgsSchema.safeParse({
      filePath: 'test.ts',
      unknownProp: 'value',
    });

    expect(result.success).toBe(false);
  });
});

describe('SearchArgsSchema', () => {
  it('should validate valid input', () => {
    const result = SearchArgsSchema.safeParse({
      query: 'authentication flow',
    });

    expect(result.success).toBe(true);
  });

  it('should apply defaults', () => {
    const result = SearchArgsSchema.safeParse({
      query: 'test',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        format: 'compact',
        limit: 10,
        scoreThreshold: 0,
      });
    }
  });

  it('should validate tokenBudget range', () => {
    const validResult = SearchArgsSchema.safeParse({
      query: 'test',
      tokenBudget: 5000,
    });
    expect(validResult.success).toBe(true);

    const invalidResult = SearchArgsSchema.safeParse({
      query: 'test',
      tokenBudget: 50000,
    });
    expect(invalidResult.success).toBe(false);
  });
});

describe('RefsArgsSchema', () => {
  it('should validate valid input', () => {
    const result = RefsArgsSchema.safeParse({
      name: 'createPlan',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.direction).toBe('both'); // default
    }
  });

  it('should validate direction values', () => {
    const validDirections = ['callees', 'callers', 'both'];
    for (const direction of validDirections) {
      const result = RefsArgsSchema.safeParse({
        name: 'test',
        direction,
      });
      expect(result.success).toBe(true);
    }

    const invalidResult = RefsArgsSchema.safeParse({
      name: 'test',
      direction: 'invalid',
    });
    expect(invalidResult.success).toBe(false);
  });

  it('should reject empty name', () => {
    const result = RefsArgsSchema.safeParse({
      name: '',
    });

    expect(result.success).toBe(false);
  });
});

describe('MapArgsSchema', () => {
  it('should validate valid input with defaults', () => {
    const result = MapArgsSchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        depth: 2,
        includeExports: true,
        includeChangeFrequency: false,
        tokenBudget: 2000,
      });
    }
  });

  it('should validate depth range', () => {
    const validResult = MapArgsSchema.safeParse({ depth: 3 });
    expect(validResult.success).toBe(true);

    const tooLowResult = MapArgsSchema.safeParse({ depth: 0 });
    expect(tooLowResult.success).toBe(false);

    const tooHighResult = MapArgsSchema.safeParse({ depth: 10 });
    expect(tooHighResult.success).toBe(false);
  });
});

describe('StatusArgsSchema', () => {
  it('should validate with defaults', () => {
    const result = StatusArgsSchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        format: 'compact',
        section: 'summary',
      });
    }
  });

  it('should validate all section values', () => {
    const sections = ['summary', 'repo', 'indexes', 'health'];
    for (const section of sections) {
      const result = StatusArgsSchema.safeParse({ section });
      expect(result.success).toBe(true);
    }
  });
});
