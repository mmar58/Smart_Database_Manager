import fs from 'fs/promises';
import fsSync from 'fs';
import { CONFIG } from '../config';
import type { QueryHistoryEntry } from '../types';

export class QueryHistoryService {
  private readonly filePath: string;
  private readonly maxItems: number;

  constructor(
    filePath = CONFIG.queryHistoryFile,
    maxItems = CONFIG.queryHistoryMax,
  ) {
    this.filePath = filePath;
    this.maxItems = maxItems;
  }

  async getAll(): Promise<QueryHistoryEntry[]> {
    if (!fsSync.existsSync(this.filePath)) return [];
    try {
      return JSON.parse(
        await fs.readFile(this.filePath, 'utf8'),
      ) as QueryHistoryEntry[];
    } catch {
      return [];
    }
  }

  async add(entry: Omit<QueryHistoryEntry, 'timestamp'>): Promise<QueryHistoryEntry[]> {
    let history = await this.getAll();
    const newEntry = { ...entry, timestamp: new Date().toISOString() } as QueryHistoryEntry;
    history.unshift(newEntry);
    if (history.length > this.maxItems) {
      history = history.slice(0, this.maxItems);
    }
    await fs.writeFile(this.filePath, JSON.stringify(history, null, 2));
    return history;
  }

  async clear(): Promise<void> {
    await fs.writeFile(this.filePath, '[]');
  }
}
