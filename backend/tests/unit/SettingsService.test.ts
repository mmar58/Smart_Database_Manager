import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { SettingsService } from '../../src/services/SettingsService';

const { tmpDir, settingsFile } = vi.hoisted(() => {
  const path = require('path');
  const os = require('os');
  const td = path.join(os.tmpdir(), `settings-test-${Date.now()}`);
  return { tmpDir: td, settingsFile: path.join(td, 'settings.json') };
});

vi.mock('../../src/config', () => ({
  CONFIG: { settingsFile },
}));

let service: SettingsService;

beforeEach(async () => {
  await fs.mkdir(tmpDir, { recursive: true });
  service = new SettingsService(settingsFile);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('SettingsService', () => {
  it('get returns empty object when file does not exist', async () => {
    expect(await service.get()).toEqual({});
  });

  it('saves and retrieves settings', async () => {
    await service.save({ theme: 'dark', pageSize: 50 });
    const s = await service.get();
    expect(s).toMatchObject({ theme: 'dark', pageSize: 50 });
  });

  it('overwrites settings', async () => {
    await service.save({ theme: 'light' });
    await service.save({ theme: 'dark', extra: true });
    expect((await service.get()).theme).toBe('dark');
  });

  it('getSync returns empty object when file does not exist', () => {
    expect(service.getSync()).toEqual({});
  });

  it('getSync returns persisted settings synchronously', async () => {
    await service.save({ syncable: true });
    expect(service.getSync()).toMatchObject({ syncable: true });
  });
});
