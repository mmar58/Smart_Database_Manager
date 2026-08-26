import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';

const { tmpDir } = vi.hoisted(() => {
  const path = require('path');
  const os = require('os');
  return { tmpDir: path.join(os.tmpdir(), `cred-int-test-${Date.now()}`) };
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

describe('POST /api/credential/set', () => {
  it('returns 400 when key is missing', async () => {
    const res = await request(app)
      .post('/api/credential/set')
      .send({ password: 'secret' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when password is missing', async () => {
    const res = await request(app)
      .post('/api/credential/set')
      .send({ key: 'mykey' });
    expect(res.status).toBe(400);
  });

  it('stores a credential and returns success', async () => {
    const res = await request(app)
      .post('/api/credential/set')
      .send({ key: 'db.prod', password: 'hunter2' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /api/credential/get', () => {
  it('returns 400 when key is missing', async () => {
    const res = await request(app).get('/api/credential/get');
    expect(res.status).toBe(400);
  });

  it('round-trips a stored credential', async () => {
    await request(app)
      .post('/api/credential/set')
      .send({ key: 'rt-key', password: 'rt-pass' });
    const res = await request(app).get('/api/credential/get?key=rt-key');
    expect(res.status).toBe(200);
    expect(res.body.password).toBe('rt-pass');
  });

  it('returns null for a missing key', async () => {
    const res = await request(app).get('/api/credential/get?key=ghost');
    expect(res.status).toBe(200);
    expect(res.body.password).toBeNull();
  });
});

describe('DELETE /api/credential/delete', () => {
  it('returns 400 when key is missing', async () => {
    const res = await request(app).delete('/api/credential/delete');
    expect(res.status).toBe(400);
  });

  it('deletes a credential', async () => {
    await request(app)
      .post('/api/credential/set')
      .send({ key: 'del-key', password: 'pass' });
    const del = await request(app).delete('/api/credential/delete?key=del-key');
    expect(del.status).toBe(200);

    const get = await request(app).get('/api/credential/get?key=del-key');
    expect(get.body.password).toBeNull();
  });
});
