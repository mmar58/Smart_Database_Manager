import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import cron from 'node-cron';
import { DatabaseManager } from '../database/DatabaseManager';
import { getSecureCredential } from './CryptoService';
import { CONFIG } from '../config';
import type { BackupProfile, BackupFile, AppSettings } from '../types';

// Active cron jobs: profileId → cron task
const activeCronJobs = new Map<string, ReturnType<typeof cron.schedule>>();

// ─── CPU snapshot ─────────────────────────────────────────────────────────────

export function getCpuUsage(): number {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  cpus.forEach((cpu) => {
    for (const t in cpu.times) total += (cpu.times as Record<string, number>)[t];
    idle += cpu.times.idle;
  });
  return Math.max(
    0,
    100 - ~~((100 * (idle / cpus.length)) / (total / cpus.length)),
  );
}

// ─── Single profile backup ────────────────────────────────────────────────────

export async function runProfileBackup(profile: BackupProfile): Promise<void> {
  const cpuUsage = getCpuUsage();
  const cpuLimit = profile.cpuLimit ?? 80;
  if (cpuUsage > cpuLimit) {
    console.warn(
      `[Backup] Profile "${profile.name}" skipped: CPU ${cpuUsage}% > limit ${cpuLimit}%`,
    );
    return;
  }

  const credentials = { ...profile.credentials };
  if (profile.credentialKey) {
    const pwd = await getSecureCredential(profile.credentialKey);
    if (pwd) credentials.password = pwd;
  }

  const databases = profile.databases ?? [];
  if (databases.length === 0) {
    console.warn(`[Backup] Profile "${profile.name}" has no databases configured`);
    return;
  }

  let dbManager: DatabaseManager | undefined;
  try {
    dbManager = new DatabaseManager(credentials);
    await dbManager.connect();

    for (const dbName of databases) {
      try {
        const result = await dbManager.exportDatabase(dbName, {
          exportMethod: 'single',
          format: 'sql',
          includeData: true,
        });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const safeProfile = (profile.name ?? 'default')
          .replace(/[^a-z0-9]/gi, '_')
          .toLowerCase();
        const filename = `${dbName}__${safeProfile}__autobackup__${timestamp}.sql`;
        await fs.writeFile(
          path.join(CONFIG.backupsDir, filename),
          result.content,
        );
        console.log(`[Backup] ✓ ${filename}`);

        // Retention
        const retention = profile.retention ?? 5;
        const prefix = `${dbName}__${safeProfile}__autobackup__`;
        const all = await fs.readdir(CONFIG.backupsDir);
        const mine: { name: string; date: number }[] = [];
        for (const f of all) {
          if (f.startsWith(prefix)) {
            const stat = await fs.stat(path.join(CONFIG.backupsDir, f));
            mine.push({ name: f, date: stat.mtimeMs });
          }
        }
        mine.sort((a, b) => b.date - a.date);
        for (let i = retention; i < mine.length; i++) {
          await fs.unlink(path.join(CONFIG.backupsDir, mine[i].name));
          console.log(`[Backup] Pruned old backup: ${mine[i].name}`);
        }
      } catch (dbErr) {
        console.error(
          `[Backup] Failed for DB "${dbName}" in profile "${profile.name}":`,
          (dbErr as Error).message,
        );
      }
    }
  } catch (connErr) {
    console.error(
      `[Backup] Connection failed for profile "${profile.name}":`,
      (connErr as Error).message,
    );
  } finally {
    if (dbManager) await dbManager.disconnect().catch(() => {});
  }
}

// ─── Backup scheduler ─────────────────────────────────────────────────────────

export function setupAutoBackup(settings: AppSettings): void {
  // Stop existing jobs
  for (const job of activeCronJobs.values()) job.stop();
  activeCronJobs.clear();

  const profiles = settings.backupProfiles ?? [];
  for (const profile of profiles) {
    if (!profile.enabled) continue;

    let cronExpr = '0 0 * * *'; // default: daily midnight
    if (profile.interval === 'hourly') cronExpr = '0 * * * *';
    else if (profile.interval === 'weekly') cronExpr = '0 0 * * 0';
    else if (profile.interval === 'custom' && profile.cronExpression)
      cronExpr = profile.cronExpression;

    try {
      const job = cron.schedule(cronExpr, () => { void runProfileBackup(profile); });
      activeCronJobs.set(profile.id ?? profile.name, job);
      console.log(`[Backup] Scheduled profile "${profile.name}" (${cronExpr})`);
    } catch (e) {
      console.error(
        `[Backup] Invalid cron for profile "${profile.name}":`,
        (e as Error).message,
      );
    }
  }
}

// ─── Backup file listing ──────────────────────────────────────────────────────

export async function listBackups(): Promise<BackupFile[]> {
  try {
    const files = await fs.readdir(CONFIG.backupsDir);
    const backups: BackupFile[] = [];
    for (const file of files) {
      const stat = await fs.stat(path.join(CONFIG.backupsDir, file));
      if (stat.isFile()) {
        const parts = file.split('_autobackup_');
        const meta = parts.length > 1 ? parts[0] : null;
        backups.push({ name: file, size: stat.size, date: stat.mtime, meta });
      }
    }
    backups.sort((a, b) => b.date.getTime() - a.date.getTime());
    return backups;
  } catch {
    return [];
  }
}

export class BackupService {
  getCpuUsage = getCpuUsage;
  runProfileBackup = runProfileBackup;
  setupAutoBackup = setupAutoBackup;
  listBackups = listBackups;
}
