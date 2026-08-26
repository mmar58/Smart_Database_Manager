import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import os from 'os';
import path from 'path';

const { tmpDir } = vi.hoisted(() => {
  const path = require('path');
  const os = require('os');
  return { tmpDir: path.join(os.tmpdir(), `auth-int-test-${Date.now()}`) };
});

vi.mock('../../../src/config', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../src/config')>();
  const path = require('path');
  return {
    CONFIG: {
      ...orig.CONFIG,
      jwtSecret: 'test-jwt-secret',
      sessionSecret: 'test-session-secret',
      dataDir: tmpDir,
      backupsDir: path.join(tmpDir, 'backups'),
      publicDir: path.join(tmpDir, 'public'),
    },
  };
});

import { createApp } from '../../../src/app';

const { app } = createApp();

describe('POST /store-credentials', () => {
  it('returns a JWT token', async () => {
    const res = await request(app).post('/store-credentials').send({
      host: 'localhost',
      port: 3306,
      username: 'root',
      database: 'mydb',
      ssl: false,
      engine: 'mysql',
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.token).toBe('string');
    // JWT format: xxxxx.yyyyy.zzzzz
    expect(res.body.token.split('.').length).toBe(3);
  });
});

describe('GET /session-credentials', () => {
  it('returns empty object when no token provided', async () => {
    const res = await request(app).get('/session-credentials');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  it('decodes a previously issued token', async () => {
    // First, obtain a token
    const storeRes = await request(app).post('/store-credentials').send({
      host: 'db.example.com',
      port: 5432,
      username: 'admin',
      database: 'prod',
      ssl: false,
      engine: 'postgresql',
    });
    const token = storeRes.body.token as string;

    // Then decode it
    const getRes = await request(app)
      .get('/session-credentials')
      .set('Authorization', `Bearer ${token}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.host).toBe('db.example.com');
    expect(getRes.body.username).toBe('admin');
    expect(getRes.body.engine).toBe('postgresql');
    // Password must NOT be in the token
    expect(getRes.body.password).toBeUndefined();
  });

  it('returns empty object for an invalid token', async () => {
    const res = await request(app)
      .get('/session-credentials')
      .set('Authorization', 'Bearer invalid.token.here');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });
});

describe('POST /logout', () => {
  it('destroys session and returns success', async () => {
    const res = await request(app).post('/logout');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
