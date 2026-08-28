import type { Socket } from 'socket.io';
import { DatabaseManager } from '../../database/DatabaseManager';

export function registerDataEditHandlers(
  socket: Socket,
  activeConnections: Map<string, DatabaseManager>,
): void {
  socket.on(
    'update_row',
    async ({
      database,
      table,
      primaryKeyColumn,
      primaryKeyValue,
      updateData,
    }: {
      database: string;
      table: string;
      primaryKeyColumn: string;
      primaryKeyValue: unknown;
      updateData: Record<string, unknown>;
    }) => {
      const db = activeConnections.get(socket.id);
      if (!db) return socket.emit('error', { message: 'No active connection' });
      try {
        await db.updateRow(database, table, primaryKeyColumn, primaryKeyValue, updateData);
        socket.emit('row_updated', { message: 'Row updated' });
      } catch (e) {
        socket.emit('error', { message: (e as Error).message });
      }
    },
  );

  socket.on(
    'delete_all_data',
    async ({ database, table }: { database: string; table: string }) => {
      const db = activeConnections.get(socket.id);
      if (!db) return socket.emit('error', { message: 'No active connection' });
      try {
        await db.deleteAllData(database, table);
        socket.emit('data_deleted', {
          message: `All data deleted from '${table}'`,
        });
      } catch (e) {
        socket.emit('error', { message: (e as Error).message });
      }
    },
  );

  socket.on(
    'delete_selected_data',
    async ({
      database,
      table,
      targetColumn,
      targetValues,
    }: {
      database: string;
      table: string;
      targetColumn: string;
      targetValues: unknown[];
    }) => {
      const db = activeConnections.get(socket.id);
      if (!db) return socket.emit('error', { message: 'No active connection' });
      try {
        await db.deleteRows(database, table, targetColumn, targetValues);
        socket.emit('data_deleted', {
          message: `${targetValues.length} rows deleted`,
        });
      } catch (e) {
        socket.emit('error', { message: (e as Error).message });
      }
    },
  );

  socket.on(
    'insert_row',
    async ({
      database,
      table,
      rowData,
    }: {
      database: string;
      table: string;
      rowData: Record<string, unknown>;
    }) => {
      const db = activeConnections.get(socket.id);
      if (!db) return socket.emit('error', { message: 'No active connection' });
      try {
        await db.insertRow(database, table, rowData);
        socket.emit('row_inserted', { message: 'Row inserted successfully' });
      } catch (e) {
        socket.emit('error', { message: (e as Error).message });
      }
    },
  );
}
