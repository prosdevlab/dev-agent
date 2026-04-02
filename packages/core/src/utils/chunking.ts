/**
 * Array chunking utility.
 *
 * Splits an array into chunks of at most `size` elements.
 * Pure function — no side effects.
 */
export function chunk<T>(array: T[], size: number): T[][] {
  if (size <= 0) throw new Error('Chunk size must be positive');
  if (array.length === 0) return [];

  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
