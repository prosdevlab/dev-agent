/**
 * PythonScanner Tests
 *
 * Tests extraction of functions, classes, methods, imports, decorators,
 * type hints, docstrings, __all__, callees, snippets, and async.
 */

import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { isTestFile } from '../../utils/test-utils';
import { PythonScanner } from '../python';
import type { Document } from '../types';

const fixturesPath = path.join(__dirname, '../__fixtures__');

describe('PythonScanner', () => {
  let scanner: PythonScanner;
  let fastApiDocs: Document[];
  let utilsDocs: Document[];

  beforeAll(async () => {
    scanner = new PythonScanner();

    fastApiDocs = await scanner.scan(['fastapi-app.py'], fixturesPath);
    utilsDocs = await scanner.scan(['python-utils.py'], fixturesPath);
  });

  describe('canHandle', () => {
    it('handles .py files', () => {
      expect(scanner.canHandle('app.py')).toBe(true);
      expect(scanner.canHandle('test_app.py')).toBe(true);
    });

    it('does not handle non-Python files', () => {
      expect(scanner.canHandle('app.ts')).toBe(false);
      expect(scanner.canHandle('app.js')).toBe(false);
    });
  });

  describe('FastAPI fixture', () => {
    it('extracts functions', () => {
      const getUser = fastApiDocs.find((d) => d.metadata.name === 'get_user');
      expect(getUser).toBeDefined();
      expect(getUser!.type).toBe('function');
      expect(getUser!.language).toBe('python');
    });

    it('detects async functions', () => {
      const getUser = fastApiDocs.find((d) => d.metadata.name === 'get_user');
      expect(getUser!.metadata.isAsync).toBe(true);
    });

    it('extracts docstrings', () => {
      const getUser = fastApiDocs.find((d) => d.metadata.name === 'get_user');
      expect(getUser!.metadata.docstring).toBe('Fetch a user by ID.');
    });

    it('extracts type hints in signature', () => {
      const getUser = fastApiDocs.find((d) => d.metadata.name === 'get_user');
      expect(getUser!.metadata.signature).toContain('user_id: int');
      expect(getUser!.metadata.signature).toContain('-> User');
    });

    it('extracts classes', () => {
      const user = fastApiDocs.find((d) => d.metadata.name === 'User');
      expect(user).toBeDefined();
      expect(user!.type).toBe('class');
      expect(user!.metadata.docstring).toBe('User data model.');
    });

    it('extracts module variables', () => {
      const maxUsers = fastApiDocs.find((d) => d.metadata.name === 'MAX_USERS');
      expect(maxUsers).toBeDefined();
      expect(maxUsers!.type).toBe('variable');
    });

    it('marks private functions as not exported', () => {
      const validateEmail = fastApiDocs.find((d) => d.metadata.name === '_validate_email');
      expect(validateEmail).toBeDefined();
      expect(validateEmail!.metadata.exported).toBe(false);
    });

    it('marks public functions as exported', () => {
      const getUser = fastApiDocs.find((d) => d.metadata.name === 'get_user');
      expect(getUser!.metadata.exported).toBe(true);
    });

    it('includes snippet on every document', () => {
      for (const doc of fastApiDocs) {
        expect(doc.metadata.snippet).toBeDefined();
        expect(doc.metadata.snippet!.length).toBeGreaterThan(0);
      }
    });

    it('extracts imports', () => {
      const fnWithImports = fastApiDocs.find((d) => d.type === 'function' && d.metadata.imports);
      expect(fnWithImports).toBeDefined();
      expect(fnWithImports!.metadata.imports).toContain(
        'from fastapi import FastAPI, HTTPException'
      );
    });

    it('extracts callees', () => {
      const getUser = fastApiDocs.find((d) => d.metadata.name === 'get_user');
      expect(getUser!.metadata.callees).toBeDefined();
      expect(getUser!.metadata.callees!.length).toBeGreaterThan(0);
    });
  });

  describe('Utils fixture (__all__)', () => {
    it('uses __all__ to control exports', () => {
      const parseDate = utilsDocs.find((d) => d.metadata.name === 'parse_date');
      const formatCurrency = utilsDocs.find((d) => d.metadata.name === 'format_currency');
      const internalHelper = utilsDocs.find((d) => d.metadata.name === '_internal_helper');

      // In __all__
      expect(parseDate!.metadata.exported).toBe(true);
      expect(formatCurrency!.metadata.exported).toBe(true);

      // Not in __all__
      expect(internalHelper!.metadata.exported).toBe(false);
    });

    it('extracts module constants', () => {
      const maxRetries = utilsDocs.find((d) => d.metadata.name === 'MAX_RETRIES');
      expect(maxRetries).toBeDefined();
      expect(maxRetries!.type).toBe('variable');
      // MAX_RETRIES is not in __all__ so it's not exported
      expect(maxRetries!.metadata.exported).toBe(false);
    });

    it('skips __all__ itself as a variable', () => {
      const allVar = utilsDocs.find((d) => d.metadata.name === '__all__');
      expect(allVar).toBeUndefined();
    });
  });

  describe('Document parity with Go/TS', () => {
    it('has all required metadata fields', () => {
      const doc = fastApiDocs.find((d) => d.type === 'function');
      expect(doc).toBeDefined();

      // Required fields that Go/TS scanners also produce
      expect(doc!.id).toBeTruthy();
      expect(doc!.text).toBeTruthy();
      expect(doc!.type).toBeTruthy();
      expect(doc!.language).toBe('python');
      expect(doc!.metadata.file).toBeTruthy();
      expect(doc!.metadata.startLine).toBeGreaterThan(0);
      expect(doc!.metadata.endLine).toBeGreaterThan(0);
      expect(doc!.metadata.name).toBeTruthy();
      expect(doc!.metadata.signature).toBeTruthy();
      expect(typeof doc!.metadata.exported).toBe('boolean');
      expect(doc!.metadata.snippet).toBeTruthy();
    });
  });
});

describe('isTestFile (Python)', () => {
  it('detects test_*.py', () => {
    expect(isTestFile('test_app.py')).toBe(true);
    expect(isTestFile('tests/test_models.py')).toBe(true);
  });

  it('detects *_test.py', () => {
    expect(isTestFile('app_test.py')).toBe(true);
  });

  it('detects conftest.py', () => {
    expect(isTestFile('conftest.py')).toBe(true);
    expect(isTestFile('tests/conftest.py')).toBe(true);
  });

  it('does not flag regular .py files', () => {
    expect(isTestFile('app.py')).toBe(false);
    expect(isTestFile('models.py')).toBe(false);
    expect(isTestFile('utils.py')).toBe(false);
  });

  it('still works for JS/TS', () => {
    expect(isTestFile('app.test.ts')).toBe(true);
    expect(isTestFile('app.spec.js')).toBe(true);
    expect(isTestFile('app.ts')).toBe(false);
  });
});
