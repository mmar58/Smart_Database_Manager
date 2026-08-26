import fs from 'fs/promises';
import fsSync from 'fs';
import { CONFIG } from '../config';
import type { AppSettings } from '../types';

export class SettingsService {
  private readonly filePath: string;

  constructor(filePath = CONFIG.settingsFile) {
    this.filePath = filePath;
  }

  async get(): Promise<AppSettings> {
    if (!fsSync.existsSync(this.filePath)) return {};
    try {
      return JSON.parse(
        await fs.readFile(this.filePath, 'utf8'),
      ) as AppSettings;
    } catch {
      return {};
    }
  }

  async save(settings: AppSettings): Promise<void> {
    await fs.writeFile(this.filePath, JSON.stringify(settings, null, 2));
  }

  /** Synchronous read used during startup (e.g. for cron scheduling). */
  getSync(): AppSettings {
    if (!fsSync.existsSync(this.filePath)) return {};
    try {
      return JSON.parse(fsSync.readFileSync(this.filePath, 'utf8')) as AppSettings;
    } catch {
      return {};
    }
  }
}
