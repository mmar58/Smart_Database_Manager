import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { QueryHistoryService } from '../../src/services/QueryHistoryService';

const { tmpDir, historyFile, MAX } = vi.hoisted(() => {
  const path = require('path');
  const os = require('os');
  const td = path.join(os.tmpdir(), `history-test-${Date.now()}`);
  return { tmpDir: td, historyFile: path.join(td, 'query_history.json'), MAX: 5 };
});

vi.mock('../../src/config', () => ({
  CONFIG: { queryHistoryFile: historyFile, queryHistoryMax: MAX },
}));

let service: QueryHistoryService;

beforeEach(async () => {
  await fs.mkdir(tmpDir, { recursive: true });
  service = new QueryHistoryService(historyFile, MAX);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('QueryHistoryService', () => {
  it('getAll returns empty array when file does not exist', async () => {
    expect(await service.getAll()).toEqual([]);
  });

  it('add prepends entry with a timestamp', async () => {
    const history = await service.add({ query: 'SELECT 1' });
    expect(history).toHaveLength(1);
    expect(history[0].query).toBe('SELECT 1');
    expect(history[0].timestamp).toBeTruthy();
  });

  it('add prepends to existing history (newest first)', async () => {
    await service.add({ query: 'first' });
    const h = await service.add({ query: 'second' });
    expect(h[0].query).toBe('second');
    expect(h[1].query).toBe('first');
  });

  it('respects max items limit by slicing oldest entries', async () => {
    for (let i = 0; i < MAX + 2; i++) {
      await service.add({ query: `q${i}` });
    }
    const h = await service.getAll();
    expect(h).toHaveLength(MAX);
    expect(h[0].query).toBe(`q${MAX + 1}`); // newest is first
  });

  it('clear empties the history', async () => {
    await service.add({ query: 'x' });
    await service.clear();
    expect(await service.getAll()).toEqual([]);
  });
});
