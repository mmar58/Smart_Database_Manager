import crypto from 'crypto';
import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import { CONFIG } from '../config';
import type { CredentialsStore } from '../types';

// ─── Machine key ─────────────────────────────────────────────────────────────

function getMachineKey(): Buffer {
  let salt: string;
  if (fsSync.existsSync(CONFIG.saltFile)) {
    salt = fsSync.readFileSync(CONFIG.saltFile, 'utf8').trim();
  } else {
    salt = crypto.randomBytes(32).toString('hex');
    fsSync.writeFileSync(CONFIG.saltFile, salt, 'utf8');
  }
  const seed =
    os.hostname() + 'db-manager-v2-' + CONFIG.cryptPepper;
  return crypto.scryptSync(seed, salt, 32);
}

// ─── AES-256-GCM helpers ──────────────────────────────────────────────────────

/**
 * Encrypt plaintext using AES-256-GCM.
 * Returns: `iv(hex):tag(hex):ciphertext(hex)`
 */
export function encryptSecret(plaintext: string): string {
  const key = getMachineKey();
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt an encrypted string produced by `encryptSecret`.
 * Throws if the format is invalid or authentication fails.
 */
export function decryptSecret(data: string): string {
  const parts = data.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted data format');
  const key = getMachineKey();
  const iv = Buffer.from(parts[0], 'hex');
  const tag = Buffer.from(parts[1], 'hex');
  const encrypted = Buffer.from(parts[2], 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

// ─── Credential store ─────────────────────────────────────────────────────────

async function loadCreds(): Promise<CredentialsStore> {
  if (!fsSync.existsSync(CONFIG.credsFile)) return {};
  try {
    return JSON.parse(await fs.readFile(CONFIG.credsFile, 'utf8')) as CredentialsStore;
  } catch {
    return {};
  }
}

export async function setSecureCredential(
  key: string,
  password: string,
): Promise<void> {
  const creds = await loadCreds();
  creds[key] = encryptSecret(password);
  await fs.writeFile(CONFIG.credsFile, JSON.stringify(creds));
}

export async function getSecureCredential(
  key: string,
): Promise<string | null> {
  const creds = await loadCreds();
  if (!creds[key]) return null;
  try {
    return decryptSecret(creds[key]);
  } catch {
    return null;
  }
}

export async function deleteSecureCredential(key: string): Promise<void> {
  const creds = await loadCreds();
  delete creds[key];
  await fs.writeFile(CONFIG.credsFile, JSON.stringify(creds));
}

// ─── Server connections ───────────────────────────────────────────────────────

export async function loadServerConnections(): Promise<Record<string, unknown>> {
  const { serverConnectionsFile } = CONFIG;
  if (!fsSync.existsSync(serverConnectionsFile)) return {};
  try {
    const encrypted = await fs.readFile(serverConnectionsFile, 'utf8');
    if (!encrypted) return {};
    const decrypted = decryptSecret(encrypted);
    return JSON.parse(decrypted) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function saveServerConnections(
  connections: Record<string, unknown>,
): Promise<void> {
  const encrypted = encryptSecret(JSON.stringify(connections));
  await fs.writeFile(CONFIG.serverConnectionsFile, encrypted);
}

// ─── CryptoService class (for DI / testing) ───────────────────────────────────

export class CryptoService {
  encrypt = encryptSecret;
  decrypt = decryptSecret;
  setCredential = setSecureCredential;
  getCredential = getSecureCredential;
  deleteCredential = deleteSecureCredential;
  loadConnections = loadServerConnections;
  saveConnections = saveServerConnections;
}
