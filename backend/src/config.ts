import path from 'path';

// Root of the project (two levels up from backend/src)
const PROJECT_ROOT = path.join(__dirname, '..', '..');

export const CONFIG = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  sessionSecret: process.env.SESSION_SECRET ?? 'db-manager-session-secret',
  jwtSecret:
    process.env.JWT_SECRET_KEY ??
    'your_fallback_secret_key_change_in_production',
  cryptPepper: process.env.CRYPT_PEPPER ?? 'default-pepper',

  // File-system paths
  dataDir: path.join(PROJECT_ROOT, 'data'),
  backupsDir: path.join(PROJECT_ROOT, 'backups'),
  settingsFile: path.join(PROJECT_ROOT, 'data', 'settings.json'),
  queryHistoryFile: path.join(PROJECT_ROOT, 'data', 'query_history.json'),
  annotationsFile: path.join(PROJECT_ROOT, 'data', 'annotations.json'),
  credsFile: path.join(PROJECT_ROOT, 'data', 'credentials.enc'),
  serverConnectionsFile: path.join(PROJECT_ROOT, 'data', 'server_connections.enc'),
  saltFile: path.join(PROJECT_ROOT, 'data', '.salt'),
  publicDir: path.join(__dirname, 'public'),

  // Query history max items
  queryHistoryMax: 200,

  // Socket.IO buffer
  maxHttpBufferSize: 50e6, // 50 MB
} as const;

export type Config = typeof CONFIG;
