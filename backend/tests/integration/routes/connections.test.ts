import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';

const { tmpDir } = vi.hoisted(() => {
  const path = require('path');
  const os = require('os');
  return { tmpDir: path.join(os.tmpdir(), `conn-int-test-${Date.now()}`) };
});

vi.mock('../../../src/config', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../src/config')>();
  const path = require('path');
  return {
    CONFIG: {
      ...orig.CONFIG,
      saltFile: path.join(tmpDir, '.salt'),
      credsFile: path.join(tmpDir, 'credentials.enc'),
      serverConnectionsFile: path.join(tmpDir, 'server_connections.enc'),
      dataDir: tmpDir,
      backupsDir: path.join(tmpDir, 'backups'),
      publicDir: path.join(tmpDir, 'public'),
    },
  };
});

import { createApp } from '../../../src/app';

const { app } = createApp();

beforeAll(async () => {
  await fs.mkdir(path.join(tmpDir, 'backups'), { recursive: true });
  await fs.mkdir(path.join(tmpDir, 'public'), { recursive: true });
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ─── POST /api/connections/save ───────────────────────────────────────────────
describe('POST /api/connections/save', () => {
  it('returns 400 when id is missing', async () => {
    const res = await request(app)
      .post('/api/connections/save')
      .send({ connection: { ipRestriction: 'all' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('returns 400 when connection is missing', async () => {
    const res = await request(app)
      .post('/api/connections/save')
      .send({ id: 'myconn' });
    expect(res.status).toBe(400);
  });

  it('saves a connection and returns success', async () => {
    const res = await request(app)
      .post('/api/connections/save')
      .send({
        id: 'test-conn',
        connection: { ipRestriction: 'all', host: 'localhost' },
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── GET /api/connections/list ────────────────────────────────────────────────
describe('GET /api/connections/list', () => {
  it('returns connections matching ipRestriction=all for any IP', async () => {
    await request(app)
      .post('/api/connections/save')
      .send({
        id: 'open',
        connection: { ipRestriction: 'all', host: 'db.example.com' },
      });
    const res = await request(app).get('/api/connections/list');
    expect(res.status).toBe(200);
    expect(res.body.connections['open']).toBeDefined();
  });

  it('excludes connections restricted to a different IP', async () => {
    await request(app)
      .post('/api/connections/save')
      .send({
        id: 'restricted',
        connection: {
          ipRestriction: 'current',
          savedIp: '1.2.3.4', // different from test runner IP
        },
      });
    const res = await request(app).get('/api/connections/list');
    // Since test IP is not 1.2.3.4, 'restricted' should not appear
    expect(res.body.connections['restricted']).toBeUndefined();
  });
});

// ─── DELETE /api/connections/delete ──────────────────────────────────────────
describe('DELETE /api/connections/delete', () => {
  it('returns 400 when id is missing', async () => {
    const res = await request(app).delete('/api/connections/delete');
    expect(res.status).toBe(400);
  });

  it('deletes an existing connection', async () => {
    await request(app)
      .post('/api/connections/save')
      .send({ id: 'to-delete', connection: { ipRestriction: 'all' } });
    const res = await request(app).delete('/api/connections/delete?id=to-delete');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── PUT /api/connections/edit ────────────────────────────────────────────────
describe('PUT /api/connections/edit', () => {
  it('returns 400 when id is missing', async () => {
    const res = await request(app)
      .put('/api/connections/edit')
      .send({ connection: { ipRestriction: 'all' } });
    expect(res.status).toBe(400);
  });

  it('edits an existing connection', async () => {
    await request(app).post('/api/connections/save').send({
      id: 'editable',
      connection: { ipRestriction: 'all', host: 'old-host' },
    });
    const res = await request(app)
      .put('/api/connections/edit')
      .send({ id: 'editable', connection: { host: 'new-host' } });
    expect(res.status).toBe(200);
  });
});
