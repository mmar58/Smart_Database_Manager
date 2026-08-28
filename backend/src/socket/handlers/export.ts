import type { Socket } from 'socket.io';
import { DatabaseManager } from '../../database/DatabaseManager';
import type { ExportOptions } from '../../types';

export function registerExportHandlers(
  socket: Socket,
  activeConnections: Map<string, DatabaseManager>,
): void {
  socket.on(
    'export_database',
    async ({
      database,
      options = {},
    }: {
      database: string;
      options?: ExportOptions;
    }) => {
      const db = activeConnections.get(socket.id);
      if (!db) return socket.emit('error', { message: 'No active connection' });
      try {
        socket.emit('database_exported', await db.exportDatabase(database, options));
      } catch (e) {
        socket.emit('error', { message: (e as Error).message });
      }
    },
  );

  socket.on(
    'export_table',
    async ({
      database,
      table,
      options = {},
    }: {
      database: string;
      table: string;
      options?: ExportOptions;
    }) => {
      const db = activeConnections.get(socket.id);
      if (!db) return socket.emit('error', { message: 'No active connection' });
      try {
        const content = await db.exportTable(database, table, options);
        const ext = options.format === 'json' ? 'json' : 'sql';
        const filename = `${table}_export_${new Date()
          .toISOString()
          .slice(0, 19)
          .replace(/:/g, '-')}.${ext}`;
        socket.emit('table_exported', {
          filename,
          content,
          size: Buffer.byteLength(content, 'utf8'),
        });
      } catch (e) {
        socket.emit('error', { message: (e as Error).message });
      }
    },
  );
}
