import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { io as ioc, Socket as ClientSocket } from 'socket.io-client';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';

const { tmpDir } = vi.hoisted(() => {
  const path = require('path');
  const os = require('os');
  return { tmpDir: path.join(os.tmpdir(), `socket-int-test-${Date.now()}`) };
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
      annotationsFile: path.join(tmpDir, 'annotations.json'),
      settingsFile: path.join(tmpDir, 'settings.json'),
      queryHistoryFile: path.join(tmpDir, 'query_history.json'),
      dataDir: tmpDir,
      backupsDir: path.join(tmpDir, 'backups'),
      publicDir: path.join(tmpDir, 'public'),
      cryptPepper: 'test-pepper',
      sessionSecret: 'test-session',
      jwtSecret: 'test-jwt',
      corsOrigin: '*',
      maxHttpBufferSize: 1e6,
      queryHistoryMax: 200,
    },
  };
});

// Mock mysql2 and pg so connect_database calls don't need a real DB
vi.mock('mysql2/promise', () => ({
  default: {
    createConnection: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue([[]]),
      execute: vi.fn().mockResolvedValue([[]]),
      end: vi.fn().mockResolvedValue(undefined),
      escape: vi.fn((v: unknown) => `'${v}'`),
      escapeId: vi.fn((id: string) => `\`${id}\``),
    }),
  },
}));

vi.mock('pg', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    end: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { createTestServer } from '../../helpers/testApp';

let serverClose: () => Promise<void>;
let baseUrl: string;
let client: ClientSocket;

function waitFor(socket: ClientSocket, event: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for '${event}'`)), 5000);
    socket.once(event, (data: unknown) => { clearTimeout(timer); resolve(data); });
  });
}

beforeAll(async () => {
  await fs.mkdir(path.join(tmpDir, 'backups'), { recursive: true });
  await fs.mkdir(path.join(tmpDir, 'public'), { recursive: true });

  const server = await createTestServer();
  serverClose = server.close;
  baseUrl = server.baseUrl;
});

afterAll(async () => {
  if (client?.connected) client.disconnect();
  await serverClose?.();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function connectClient(): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioc(baseUrl, { transports: ['polling'] });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

// ─── connect_database ─────────────────────────────────────────────────────────
describe('Socket: connect_database', () => {
  it('emits connection_success for a mocked MySQL connection', async () => {
    client = await connectClient();
    const promise = waitFor(client, 'connection_success');
    client.emit('connect_database', {
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: 'pass',
      engine: 'mysql',
    });
    const data = (await promise) as { message: string };
    expect(data.message).toContain('Connected');
    client.disconnect();
  });
});

// ─── get_databases ────────────────────────────────────────────────────────────
describe('Socket: get_databases', () => {
  it('emits error when no active connection', async () => {
    client = await connectClient();
    const promise = waitFor(client, 'error');
    client.emit('get_databases');
    const err = (await promise) as { message: string };
    expect(err.message).toContain('No active connection');
    client.disconnect();
  });
});

// ─── Annotations ─────────────────────────────────────────────────────────────
describe('Socket: annotations', () => {
  it('save and retrieve annotation', async () => {
    client = await connectClient();

    const saveProm = waitFor(client, 'annotations');
    client.emit('save_annotation', { key: 'mydb.users', note: 'Primary table' });
    const saved = (await saveProm) as Record<string, { note: string }>;
    expect(saved['mydb.users'].note).toBe('Primary table');

    const getProm = waitFor(client, 'annotations');
    client.emit('get_annotations');
    const got = (await getProm) as Record<string, { note: string }>;
    expect(got['mydb.users'].note).toBe('Primary table');

    client.disconnect();
  });
});

// ─── Query History ────────────────────────────────────────────────────────────
describe('Socket: query history', () => {
  it('add and retrieve query history', async () => {
    client = await connectClient();

    const addProm = waitFor(client, 'query_history');
    client.emit('save_query_history', { query: 'SELECT * FROM users', database: 'mydb' });
    const history = (await addProm) as Array<{ query: string }>;
    expect(history[0].query).toBe('SELECT * FROM users');

    client.disconnect();
  });

  it('clear empties the history', async () => {
    client = await connectClient();
    await new Promise<void>((r) => {
      client.once('query_history', () => r());
      client.emit('save_query_history', { query: 'DELETE FROM x' });
    });

    const clearProm = waitFor(client, 'query_history');
    client.emit('clear_query_history');
    const cleared = (await clearProm) as unknown[];
    expect(cleared).toHaveLength(0);

    client.disconnect();
  });
});

// ─── Settings ─────────────────────────────────────────────────────────────────
describe('Socket: settings', () => {
  it('save and retrieve settings', async () => {
    client = await connectClient();

    const saveProm = waitFor(client, 'settings_saved');
    client.emit('save_settings', { theme: 'dark', pageSize: 100 });
    await saveProm;

    const getProm = waitFor(client, 'settings');
    client.emit('get_settings');
    const settings = (await getProm) as { theme: string };
    expect(settings.theme).toBe('dark');

    client.disconnect();
  });
});
