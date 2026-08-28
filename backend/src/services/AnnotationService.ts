import fs from 'fs/promises';
import fsSync from 'fs';
import { CONFIG } from '../config';
import type { Annotation, AnnotationsMap } from '../types';

export class AnnotationService {
  private readonly filePath: string;

  constructor(filePath = CONFIG.annotationsFile) {
    this.filePath = filePath;
  }

  async getAll(): Promise<AnnotationsMap> {
    if (!fsSync.existsSync(this.filePath)) return {};
    try {
      return JSON.parse(
        await fs.readFile(this.filePath, 'utf8'),
      ) as AnnotationsMap;
    } catch {
      return {};
    }
  }

  async save(key: string, note: string): Promise<AnnotationsMap> {
    const data = await this.getAll();
    data[key] = { note, updatedAt: new Date().toISOString() } as Annotation;
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2));
    return data;
  }

  async delete(key: string): Promise<AnnotationsMap> {
    const data = await this.getAll();
    delete data[key];
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2));
    return data;
  }
}
