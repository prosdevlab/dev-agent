import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/*.d.ts',
        '**/test/**',
        '**/types.ts', // Type definition files
        '**/*.types.ts',
        '**/index.ts', // Re-export files
      ],
    },
  },
  resolve: {
    alias: {
      '@prosdevlab/dev-agent-core': resolve(__dirname, 'packages/core/src'),
      '@prosdevlab/dev-agent-subagents': resolve(__dirname, 'packages/subagents/src'),
      '@prosdevlab/dev-agent-cli': resolve(__dirname, 'packages/cli/src'),
      '@prosdevlab/dev-agent-integrations': resolve(__dirname, 'packages/integrations/src'),
      '@prosdevlab/kero': resolve(__dirname, 'packages/logger/src'),
    },
  },
});
