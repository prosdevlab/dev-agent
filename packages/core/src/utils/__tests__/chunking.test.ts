/**
 * Tests for array chunking utility.
 * Pure function — no I/O, no mocks.
 */

import { describe, expect, it } from 'vitest';
import { chunk } from '../chunking';

describe('chunk', () => {
  it('should return single chunk for small arrays', () => {
    expect(chunk([1, 2, 3], 5)).toEqual([[1, 2, 3]]);
  });

  it('should split evenly', () => {
    expect(chunk([1, 2, 3, 4, 5, 6], 3)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it('should handle uneven splits', () => {
    expect(chunk([1, 2, 3, 4, 5], 3)).toEqual([
      [1, 2, 3],
      [4, 5],
    ]);
  });

  it('should handle single element chunks', () => {
    expect(chunk([1, 2, 3], 1)).toEqual([[1], [2], [3]]);
  });

  it('should return empty for empty array', () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it('should handle chunk size equal to array length', () => {
    expect(chunk([1, 2, 3], 3)).toEqual([[1, 2, 3]]);
  });

  it('should handle chunk size larger than array', () => {
    expect(chunk([1, 2], 100)).toEqual([[1, 2]]);
  });

  it('should throw on non-positive size', () => {
    expect(() => chunk([1], 0)).toThrow('Chunk size must be positive');
    expect(() => chunk([1], -1)).toThrow('Chunk size must be positive');
  });

  it('should work with large arrays (6000 items, chunks of 3000)', () => {
    const items = Array.from({ length: 6000 }, (_, i) => i);
    const result = chunk(items, 3000);
    expect(result.length).toBe(2);
    expect(result[0].length).toBe(3000);
    expect(result[1].length).toBe(3000);
  });

  it('should work with 7500 items in chunks of 3000', () => {
    const items = Array.from({ length: 7500 }, (_, i) => i);
    const result = chunk(items, 3000);
    expect(result.length).toBe(3);
    expect(result[0].length).toBe(3000);
    expect(result[1].length).toBe(3000);
    expect(result[2].length).toBe(1500);
  });
});
