import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import {
  encryptSecret,
  decryptSecret,
  setSecureCredential,
  getSecureCredential,
  deleteSecureCredential,
} from '../../src/services/CryptoService';

const { tmpDir } = vi.hoisted(() => {
  const path = require('path');
  const os = require('os');
  return { tmpDir: path.join(os.tmpdir(), `crypto-test-${Date.now()}`) };
});

vi.mock('../../src/config', () => {
  const path = require('path');
  return {
    CONFIG: {
      saltFile: path.join(tmpDir, '.salt'),
      credsFile: path.join(tmpDir, 'credentials.enc'),
      cryptPepper: 'test-pepper',
    },
  };
});

beforeEach(async () => {
  await fs.mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ─── encryptSecret / decryptSecret ───────────────────────────────────────────
describe('encryptSecret / decryptSecret', () => {
  it('round-trips a simple string', () => {
    const plain = 'my-super-secret-password';
    const enc = encryptSecret(plain);
    expect(decryptSecret(enc)).toBe(plain);
  });

  it('round-trips an empty string', () => {
    expect(decryptSecret(encryptSecret(''))).toBe('');
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const enc1 = encryptSecret('hello');
    const enc2 = encryptSecret('hello');
    expect(enc1).not.toBe(enc2);
  });

  it('encrypted value has format iv:tag:ciphertext (3 colon-separated parts)', () => {
    const enc = encryptSecret('test');
    const parts = enc.split(':');
    expect(parts).toHaveLength(3);
    expect(parts[0].length).toBeGreaterThan(0); // IV (hex)
    expect(parts[1].length).toBeGreaterThan(0); // Tag (hex)
    expect(parts[2].length).toBeGreaterThan(0); // Ciphertext (hex)
  });

  it('throws on invalid format (fewer than 3 parts)', () => {
    expect(() => decryptSecret('bad:data')).toThrow('Invalid encrypted data format');
  });

  it('throws when ciphertext is tampered with', () => {
    const enc = encryptSecret('secret');
    const parts = enc.split(':');
    parts[2] = 'deadbeef'.repeat(10); // corrupt ciphertext
    expect(() => decryptSecret(parts.join(':'))).toThrow();
  });
});

// ─── setSecureCredential / getSecureCredential / deleteSecureCredential ──────
describe('credential store', () => {
  it('stores and retrieves a credential', async () => {
    await setSecureCredential('db-prod', 'hunter2');
    expect(await getSecureCredential('db-prod')).toBe('hunter2');
  });

  it('returns null for a missing key', async () => {
    expect(await getSecureCredential('does-not-exist')).toBeNull();
  });

  it('overwrites an existing credential', async () => {
    await setSecureCredential('key', 'old');
    await setSecureCredential('key', 'new');
    expect(await getSecureCredential('key')).toBe('new');
  });

  it('deletes a credential', async () => {
    await setSecureCredential('temp', 'value');
    await deleteSecureCredential('temp');
    expect(await getSecureCredential('temp')).toBeNull();
  });

  it('deleting a non-existent key does not throw', async () => {
    await expect(deleteSecureCredential('ghost')).resolves.toBeUndefined();
  });

  it('persists the salt file on first use', () => {
    encryptSecret('x');
    expect(fsSync.existsSync(path.join(tmpDir, '.salt'))).toBe(true);
  });
});
