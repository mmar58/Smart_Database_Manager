import type { Socket } from 'socket.io';
import { DatabaseManager } from '../../database/DatabaseManager';

export function registerImportHandlers(
  socket: Socket,
  activeConnections: Map<string, DatabaseManager>,
): void {
  socket.on(
    'import_database',
    async ({
      database,
      content,
      type,
    }: {
      database: string;
      content: string;
      type: 'json' | 'sql';
    }) => {
      const db = activeConnections.get(socket.id);
      if (!db) return socket.emit('error', { message: 'No active connection' });
      try {
        if (type === 'json') {
          await db.importDatabaseFromJson(database, content);
        } else {
          await db.importDatabase(database, content);
        }
        socket.emit('database_imported', {
          message: 'Import completed successfully',
        });
      } catch (e) {
        socket.emit('error', { message: (e as Error).message });
      }
    },
  );
}
