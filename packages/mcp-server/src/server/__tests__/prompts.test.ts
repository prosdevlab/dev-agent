import { describe, expect, it } from 'vitest';
import { PromptRegistry } from '../prompts';

describe('PromptRegistry', () => {
  describe('constructor', () => {
    it('should register default prompts on initialization', () => {
      const registry = new PromptRegistry();
      const prompts = registry.listPrompts();

      expect(prompts.length).toBeGreaterThan(0);
    });

    it('should include find-pattern prompt', () => {
      const registry = new PromptRegistry();

      expect(registry.hasPrompt('find-pattern')).toBe(true);
    });

    it('should include repo-overview prompt', () => {
      const registry = new PromptRegistry();

      expect(registry.hasPrompt('repo-overview')).toBe(true);
    });
  });

  describe('listPrompts', () => {
    it('should return all registered prompts', () => {
      const registry = new PromptRegistry();
      const prompts = registry.listPrompts();

      expect(Array.isArray(prompts)).toBe(true);
      expect(prompts.length).toBeGreaterThan(3);
    });

    it('should return prompt definitions with name and description', () => {
      const registry = new PromptRegistry();
      const prompts = registry.listPrompts();

      for (const prompt of prompts) {
        expect(prompt.name).toBeDefined();
        expect(prompt.description).toBeDefined();
      }
    });

    it('should include prompt arguments', () => {
      const registry = new PromptRegistry();
      const prompts = registry.listPrompts();
      const findPattern = prompts.find((p) => p.name === 'find-pattern');

      expect(findPattern?.arguments).toBeDefined();
      expect(findPattern?.arguments?.length).toBeGreaterThan(0);
    });

    it('should mark required arguments', () => {
      const registry = new PromptRegistry();
      const prompts = registry.listPrompts();
      const findPattern = prompts.find((p) => p.name === 'find-pattern');
      const descArg = findPattern?.arguments?.find((a) => a.name === 'description');

      expect(descArg?.required).toBe(true);
    });
  });

  describe('getPrompt', () => {
    it('should retrieve prompt by name', () => {
      const registry = new PromptRegistry();
      const prompt = registry.getPrompt('find-pattern', { description: 'error handling' });

      expect(prompt).toBeDefined();
      expect(prompt?.messages).toBeDefined();
    });

    it('should return null for non-existent prompt', () => {
      const registry = new PromptRegistry();
      const prompt = registry.getPrompt('non-existent');

      expect(prompt).toBeNull();
    });

    it('should generate messages with arguments', () => {
      const registry = new PromptRegistry();
      const prompt = registry.getPrompt('find-pattern', { description: 'error handling' });

      expect(prompt?.messages).toHaveLength(1);
      expect(prompt?.messages[0].role).toBe('user');
      expect(prompt?.messages[0].content.text).toContain('error handling');
    });

    it('should include description', () => {
      const registry = new PromptRegistry();
      const prompt = registry.getPrompt('find-pattern', { description: 'test' });

      expect(prompt?.description).toBeDefined();
    });

    it('should handle prompts without arguments', () => {
      const registry = new PromptRegistry();
      const prompt = registry.getPrompt('repo-overview');

      expect(prompt).toBeDefined();
      expect(prompt?.messages).toBeDefined();
    });

    it('should use default empty args when not provided', () => {
      const registry = new PromptRegistry();
      const prompt = registry.getPrompt('repo-overview');

      expect(prompt).toBeDefined();
    });

    it('should generate different messages for different args', () => {
      const registry = new PromptRegistry();
      const prompt1 = registry.getPrompt('find-similar', { file_path: 'src/a.ts' });
      const prompt2 = registry.getPrompt('find-similar', { file_path: 'src/b.ts' });

      expect(prompt1?.messages[0].content.text).toContain('src/a.ts');
      expect(prompt2?.messages[0].content.text).toContain('src/b.ts');
    });
  });

  describe('hasPrompt', () => {
    it('should return true for existing prompt', () => {
      const registry = new PromptRegistry();

      expect(registry.hasPrompt('find-pattern')).toBe(true);
      expect(registry.hasPrompt('repo-overview')).toBe(true);
    });

    it('should return false for non-existent prompt', () => {
      const registry = new PromptRegistry();

      expect(registry.hasPrompt('non-existent')).toBe(false);
    });
  });

  describe('default prompts', () => {
    it('should include all expected workflow prompts', () => {
      const registry = new PromptRegistry();
      const expectedPrompts = [
        'find-pattern',
        'repo-overview',
        'find-similar',
        'explore-relationships',
        'quick-search',
      ];

      for (const name of expectedPrompts) {
        expect(registry.hasPrompt(name)).toBe(true);
      }
    });

    it('should register exactly 5 prompts', () => {
      const registry = new PromptRegistry();
      const prompts = registry.listPrompts();

      expect(prompts).toHaveLength(5);
    });

    it('should provide user-facing messages', () => {
      const registry = new PromptRegistry();
      // Test with a prompt that has no required args
      const prompt = registry.getPrompt('repo-overview');
      expect(prompt?.messages.length).toBeGreaterThan(0);
      expect(prompt?.messages[0].content.text.length).toBeGreaterThan(0);
    });
  });
});
