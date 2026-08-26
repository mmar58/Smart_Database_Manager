import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import os from 'os';
import path from 'path';

const { tmpDir } = vi.hoisted(() => {
  const path = require('path');
  const os = require('os');
  return { tmpDir: path.join(os.tmpdir(), `system-int-test-${Date.now()}`) };
});

vi.mock('../../../src/config', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../src/config')>();
  const path = require('path');
  return {
    CONFIG: {
      ...orig.CONFIG,
      dataDir: tmpDir,
      backupsDir: path.join(tmpDir, 'backups'),
      publicDir: path.join(tmpDir, 'public'),
    },
  };
});

import { createApp } from '../../../src/app';

const { app } = createApp();

describe('GET /api/system-stats', () => {
  it('returns a valid system stats object', async () => {
    const res = await request(app).get('/api/system-stats');
    expect(res.status).toBe(200);

    // Shape validation
    expect(typeof res.body.cpuUsage).toBe('number');
    expect(res.body.cpuUsage).toBeGreaterThanOrEqual(0);
    expect(res.body.cpuUsage).toBeLessThanOrEqual(100);

    expect(typeof res.body.memUsage).toBe('string');
    expect(typeof res.body.totalMem).toBe('string');
    expect(typeof res.body.usedMem).toBe('string');
    expect(typeof res.body.cpuModel).toBe('string');
    expect(typeof res.body.cpuCount).toBe('number');
    expect(res.body.cpuCount).toBeGreaterThan(0);
    expect(typeof res.body.platform).toBe('string');
    expect(typeof res.body.uptime).toBe('number');
  });

  it('totalMem ends with GB', async () => {
    const res = await request(app).get('/api/system-stats');
    expect(res.body.totalMem).toMatch(/GB$/);
  });
});

describe('GET /api/my-ip', () => {
  it('returns an ip field', async () => {
    const res = await request(app).get('/api/my-ip');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ip');
    expect(typeof res.body.ip).toBe('string');
  });
});
