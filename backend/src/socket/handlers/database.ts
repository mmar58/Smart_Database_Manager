import type { Socket } from 'socket.io';
import { DatabaseManager } from '../../database/DatabaseManager';
import type { DbCredentials } from '../../types';

export function registerDatabaseHandlers(
  socket: Socket,
  activeConnections: Map<string, DatabaseManager>,
): void {
  socket.on('connect_database', async (credentials: DbCredentials) => {
    console.log(
      `[connect_database] socket=${socket.id} host=${credentials.host} engine=${credentials.engine}`,
    );
    try {
      const dbManager = new DatabaseManager(credentials);
      await dbManager.connect();
      activeConnections.set(socket.id, dbManager);
      console.log(`[connect_database] SUCCESS socket=${socket.id}`);
      socket.emit('connection_success', {
        message: 'Connected to database',
        connectionId: socket.id,
      });
    } catch (error) {
      console.error(
        `[connect_database] FAILED socket=${socket.id}:`,
        (error as Error).message,
      );
      socket.emit('connection_error', {
        message: 'Failed to connect',
        error: (error as Error).message,
      });
    }
  });

  socket.on('disconnect_database', async () => {
    const dbManager = activeConnections.get(socket.id);
    if (dbManager) {
      await dbManager.disconnect();
      activeConnections.delete(socket.id);
      socket.emit('disconnection_success', { message: 'Disconnected' });
    }
  });

  socket.on('get_databases', async () => {
    const db = activeConnections.get(socket.id);
    if (!db) return socket.emit('error', { message: 'No active connection' });
    try {
      socket.emit('databases_list', await db.getDatabases());
    } catch (e) {
      socket.emit('error', { message: (e as Error).message });
    }
  });

  socket.on('get_tables', async (databaseName: string) => {
    const db = activeConnections.get(socket.id);
    if (!db) return socket.emit('error', { message: 'No active connection' });
    try {
      socket.emit('tables_list', {
        database: databaseName,
        tables: await db.getTables(databaseName),
      });
    } catch (e) {
      socket.emit('error', { message: (e as Error).message });
    }
  });

  socket.on(
    'get_table_structure',
    async ({ database, table }: { database: string; table: string }) => {
      const db = activeConnections.get(socket.id);
      if (!db) return socket.emit('error', { message: 'No active connection' });
      try {
        socket.emit('table_structure', {
          database,
          table,
          structure: await db.getTableStructure(database, table),
        });
      } catch (e) {
        socket.emit('error', { message: (e as Error).message });
      }
    },
  );

  socket.on(
    'get_table_data',
    async ({
      database,
      table,
      limit = 100,
      offset = 0,
      sortColumn = null,
      sortDirection = 'ASC',
      searchFilters = null,
      searchLogic = 'AND',
    }: {
      database: string;
      table: string;
      limit?: number;
      offset?: number;
      sortColumn?: string | null;
      sortDirection?: string;
      searchFilters?: import('../../types').SearchFilter[] | null;
      searchLogic?: string;
    }) => {
      const db = activeConnections.get(socket.id);
      if (!db) return socket.emit('error', { message: 'No active connection' });
      try {
        const result = await db.getTableData(
          database,
          table,
          limit,
          offset,
          sortColumn,
          sortDirection,
          searchFilters,
          searchLogic,
        );
        socket.emit('table_data', { database, table, ...result });
      } catch (e) {
        socket.emit('error', { message: (e as Error).message });
      }
    },
  );

  socket.on(
    'create_database',
    async (databaseName: string) => {
      const db = activeConnections.get(socket.id);
      if (!db) return socket.emit('error', { message: 'No active connection' });
      try {
        await db.createDatabase(databaseName);
        socket.emit('database_created', {
          message: `Database '${databaseName}' created`,
        });
      } catch (e) {
        socket.emit('error', { message: (e as Error).message });
      }
    },
  );

  socket.on('drop_database', async (databaseName: string) => {
    const db = activeConnections.get(socket.id);
    if (!db) return socket.emit('error', { message: 'No active connection' });
    try {
      await db.dropDatabase(databaseName);
      socket.emit('database_dropped', {
        message: `Database '${databaseName}' dropped`,
      });
    } catch (e) {
      socket.emit('error', { message: (e as Error).message });
    }
  });

  socket.on(
    'alter_table',
    async ({
      database,
      table,
      alterQuery,
    }: {
      database: string;
      table: string;
      alterQuery: string;
    }) => {
      const db = activeConnections.get(socket.id);
      if (!db) return socket.emit('error', { message: 'No active connection' });
      try {
        await db.alterTable(database, table, alterQuery);
        socket.emit('table_altered', { message: `Table '${table}' altered` });
      } catch (e) {
        socket.emit('error', { message: (e as Error).message });
      }
    },
  );

  socket.on(
    'get_table_indexes',
    async ({ database, table }: { database: string; table: string }) => {
      const db = activeConnections.get(socket.id);
      if (!db) return socket.emit('error', { message: 'No active connection' });
      try {
        socket.emit('table_indexes', {
          database,
          table,
          indexes: await db.getTableIndexes(database, table),
        });
      } catch (e) {
        socket.emit('error', { message: (e as Error).message });
      }
    },
  );

  socket.on(
    'get_table_constraints',
    async ({ database, table }: { database: string; table: string }) => {
      const db = activeConnections.get(socket.id);
      if (!db) return socket.emit('error', { message: 'No active connection' });
      try {
        socket.emit('table_constraints', {
          database,
          table,
          constraints: await db.getTableConstraints(database, table),
        });
      } catch (e) {
        socket.emit('error', { message: (e as Error).message });
      }
    },
  );

  socket.on(
    'drop_table',
    async ({ database, table }: { database: string; table: string }) => {
      const db = activeConnections.get(socket.id);
      if (!db) return socket.emit('error', { message: 'No active connection' });
      try {
        await db.dropTable(database, table);
        socket.emit('table_dropped', { message: `Table '${table}' dropped` });
      } catch (e) {
        socket.emit('error', { message: (e as Error).message });
      }
    },
  );

  socket.on(
    'get_row_count',
    async ({
      database,
      table,
      whereClause = null,
    }: {
      database: string;
      table: string;
      whereClause?: string | null;
    }) => {
      const db = activeConnections.get(socket.id);
      if (!db) return socket.emit('error', { message: 'No active connection' });
      try {
        socket.emit('row_count_result', {
          database,
          table,
          count: await db.getRowCount(database, table, whereClause),
          whereClause,
        });
      } catch (e) {
        socket.emit('error', { message: (e as Error).message });
      }
    },
  );

  socket.on(
    'get_db_sizes',
    async () => {
      const db = activeConnections.get(socket.id);
      if (!db) return;
      try { socket.emit('db_sizes', await db.getDatabaseSizes()); } catch { /* non-fatal */ }
    },
  );

  socket.on('get_table_sizes', async (database: string) => {
    const db = activeConnections.get(socket.id);
    if (!db) return;
    try {
      socket.emit('table_sizes', {
        database,
        sizes: await db.getTableSizes(database),
      });
    } catch { /* non-fatal */ }
  });
}
