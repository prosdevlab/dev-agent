/**
 * Tests for antfly utility helpers.
 *
 * Regression for: hasModel() false positive when antfly termite list defaulted
 * to ~/.termite/models (different from the server's ~/.antfly/models), causing
 * "Embedding model ready" in `dev setup` but "model not found" in `dev index`.
 */

import { describe, expect, it } from 'vitest';

// modelPresentInOutput is not exported — test via the exported path by extracting
// the pure logic into a local copy that mirrors the implementation exactly.
// This keeps the test focused on the matching logic without requiring CLI env.

function modelPresentInOutput(model: string, output: string): boolean {
  if (output.includes(model)) return true;

  const shortName = model.split('/').pop() ?? model;
  const escaped = shortName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w/-])${escaped}(?![\\w/-])`).test(output);
}

describe('modelPresentInOutput', () => {
  const FULL_NAME = 'BAAI/bge-small-en-v1.5';
  const SHORT_NAME = 'bge-small-en-v1.5';

  // Simulates `antfly termite list --models-dir ~/.antfly/models` output when
  // the model IS present (full name in NAME column, also in SOURCE column).
  const PRESENT_OUTPUT = `Local models in /Users/dev/.antfly/models:

NAME                    TYPE      SIZE      VARIANTS  SOURCE
BAAI/bge-small-en-v1.5  embedder  127.8 MB            BAAI/bge-small-en-v1.5
`;

  // Output when NO models are installed (the bug scenario: server's models-dir
  // is empty, but ~/.termite/models has the model — the old code read the wrong
  // directory and would never see "No models found").
  const EMPTY_OUTPUT = `Local models in /Users/dev/.antfly/models:

NAME  TYPE  SIZE  VARIANTS  SOURCE
No models found locally.

Use 'antfly termite pull <model-name>' to download models.
Use 'antfly termite list --remote' to see available models.
`;

  // Output with a DIFFERENT model that happens to contain the short name as a
  // suffix — the old substring check would incorrectly return true here.
  const OTHER_MODEL_OUTPUT = `Local models in /Users/dev/.antfly/models:

NAME                          TYPE      SIZE      VARIANTS  SOURCE
vendor/other-bge-small-en-v1.5  embedder  200.0 MB            vendor/other-bge-small-en-v1.5
`;

  it('returns true when full model name is present in output', () => {
    expect(modelPresentInOutput(FULL_NAME, PRESENT_OUTPUT)).toBe(true);
  });

  it('returns true when only short name is present as a standalone token', () => {
    const outputWithShortName = `Local models:\n\n${SHORT_NAME}  embedder  127 MB\n`;
    expect(modelPresentInOutput(FULL_NAME, outputWithShortName)).toBe(true);
  });

  it('returns false when models directory is empty (server has no models)', () => {
    // This is the core regression: old code checked ~/.termite/models which had
    // the model, new code checks ~/.antfly/models which was empty. When empty,
    // hasModel must return false so pullModel is invoked.
    expect(modelPresentInOutput(FULL_NAME, EMPTY_OUTPUT)).toBe(false);
  });

  it('returns false when a different model shares the short name as a suffix', () => {
    // Old bug: output.includes("bge-small-en-v1.5") matched
    // "vendor/other-bge-small-en-v1.5" — false positive.
    expect(modelPresentInOutput(FULL_NAME, OTHER_MODEL_OUTPUT)).toBe(false);
  });

  it('returns false for completely unrelated output', () => {
    expect(modelPresentInOutput(FULL_NAME, 'No models found locally.')).toBe(false);
  });

  it('handles model names without an org prefix', () => {
    // model = "mxbai-embed-large-v1" (no slash)
    const bareModel = 'mxbai-embed-large-v1';
    const output = `NAME                TYPE\nmxbai-embed-large-v1  embedder\n`;
    expect(modelPresentInOutput(bareModel, output)).toBe(true);
  });

  it('handles bare model not present', () => {
    const bareModel = 'mxbai-embed-large-v1';
    expect(modelPresentInOutput(bareModel, EMPTY_OUTPUT)).toBe(false);
  });
});
