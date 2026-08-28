import fs from 'fs/promises';
import path from 'path';
import type { Socket } from 'socket.io';
import { DatabaseManager } from '../../database/DatabaseManager';
import { listBackups } from '../../services/BackupService';
import { CONFIG } from '../../config';

export function registerBackupHandlers(
  socket: Socket,
  activeConnections: Map<string, DatabaseManager>,
): void {
  socket.on('list_backups', async () => {
    try {
      socket.emit('backups_list', await listBackups());
    } catch {
      socket.emit('error', { message: 'Failed to list backups' });
    }
  });

  socket.on('delete_backup', async (filename: string) => {
    try {
      await fs.unlink(path.join(CONFIG.backupsDir, filename));
      socket.emit('backup_deleted', { message: `Deleted ${filename}` });
    } catch {
      socket.emit('error', { message: 'Failed to delete backup' });
    }
  });

  socket.on(
    'restore_backup',
    async ({
      filename,
      targetDatabase,
    }: {
      filename: string;
      targetDatabase: string;
    }) => {
      const db = activeConnections.get(socket.id);
      if (!db) return socket.emit('error', { message: 'No active connection' });
      try {
        const content = await fs.readFile(
          path.join(CONFIG.backupsDir, filename),
          'utf8',
        );
        if (filename.endsWith('.json')) {
          await db.importDatabaseFromJson(targetDatabase, content);
        } else {
          await db.importDatabase(targetDatabase, content);
        }
        socket.emit('backup_restored', {
          message: `Restored ${filename} to ${targetDatabase}`,
        });
      } catch (e) {
        socket.emit('error', {
          message: `Restore failed: ${(e as Error).message}`,
        });
      }
    },
  );
}
