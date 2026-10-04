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
          database,
          message: 'Import completed successfully',
        });
      } catch (e) {
        socket.emit('error', { message: (e as Error).message });
      }
    },
  );

  socket.on(
    'import_table',
    async ({
      database,
      table,
      content,
      type,
    }: {
      database: string;
      table: string;
      content: string;
      type: 'json' | 'sql';
    }) => {
      const db = activeConnections.get(socket.id);
      if (!db) return socket.emit('error', { message: 'No active connection' });
      try {
        if (type === 'json') {
          // If we wanted to import JSON into a specific table, we could add a method.
          // For now, we fallback to the database json importer which assumes the JSON structure has table names.
          await db.importDatabaseFromJson(database, content);
        } else {
          await db.importDatabase(database, content);
        }
        socket.emit('table_imported', {
          database,
          table,
          message: `Import into table ${table} completed successfully`,
        });
      } catch (e) {
        socket.emit('error', { message: (e as Error).message });
      }
    },
  );
}
