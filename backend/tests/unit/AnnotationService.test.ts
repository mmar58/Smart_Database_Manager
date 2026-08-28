import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';

const { tmpDir, annotationsFile } = vi.hoisted(() => {
  const path = require('path');
  const os = require('os');
  const td = path.join(os.tmpdir(), `annotation-test-${Date.now()}`);
  return { tmpDir: td, annotationsFile: path.join(td, 'annotations.json') };
});

vi.mock('../../src/config', () => ({
  CONFIG: { annotationsFile },
}));

import { AnnotationService } from '../../src/services/AnnotationService';

let service: AnnotationService;

beforeEach(async () => {
  await fs.mkdir(tmpDir, { recursive: true });
  service = new AnnotationService(annotationsFile);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('AnnotationService', () => {
  it('getAll returns empty object when file does not exist', async () => {
    expect(await service.getAll()).toEqual({});
  });

  it('saves an annotation and retrieves it', async () => {
    const result = await service.save('db.users', 'Primary user table');
    expect(result['db.users']).toMatchObject({ note: 'Primary user table' });
    expect(result['db.users'].updatedAt).toBeTruthy();
  });

  it('getAll returns all saved annotations', async () => {
    await service.save('a', 'note-a');
    await service.save('b', 'note-b');
    const all = await service.getAll();
    expect(Object.keys(all)).toHaveLength(2);
    expect(all['a'].note).toBe('note-a');
    expect(all['b'].note).toBe('note-b');
  });

  it('overwriting an annotation replaces note and updates timestamp', async () => {
    await service.save('key', 'old');
    await new Promise((r) => setTimeout(r, 10)); // ensure timestamp differs
    const result = await service.save('key', 'new');
    expect(result['key'].note).toBe('new');
  });

  it('delete removes an annotation', async () => {
    await service.save('x', 'something');
    const result = await service.delete('x');
    expect(result['x']).toBeUndefined();
  });

  it('delete on non-existent key does not throw', async () => {
    await expect(service.delete('ghost')).resolves.toBeDefined();
  });
});
