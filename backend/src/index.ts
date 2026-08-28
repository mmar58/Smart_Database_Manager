import 'dotenv/config';
import http from 'http';
import fsSync from 'fs';
import { CONFIG } from './config';
import { createApp } from './app';
import { initSocketIo } from './socket';
import { setupAutoBackup } from './services/BackupService';
import { SettingsService } from './services/SettingsService';

// ── Ensure required directories exist ────────────────────────────────────────
[CONFIG.dataDir, CONFIG.backupsDir].forEach((dir) => {
  if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────
const { app, sessionMiddleware } = createApp();
const httpServer = http.createServer(app);

initSocketIo(httpServer, sessionMiddleware);

// Kick off auto-backup scheduler using persisted settings
const settingsService = new SettingsService();
setupAutoBackup(settingsService.getSync());

httpServer.listen(CONFIG.port, () => {
  console.log(`\n⚡ DB Manager running at http://localhost:${CONFIG.port}\n`);
});
