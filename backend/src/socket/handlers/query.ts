import type { Socket } from 'socket.io';
import { Client as PgClient } from 'pg';
import { DatabaseManager } from '../../database/DatabaseManager';
import type { SlowQuery, ModifiedTable, ForeignKey } from '../../types';

export function registerQueryHandlers(
  socket: Socket,
  activeConnections: Map<string, DatabaseManager>,
): void {
  socket.on(
    'execute_query',
    async ({ database, query }: { database: string; query: string }) => {
      const db = activeConnections.get(socket.id);
      if (!db) return socket.emit('error', { message: 'No active connection' });
      try {
        socket.emit('query_result', {
          query,
          result: await db.executeQuery(database, query),
        });
      } catch (e) {
        socket.emit('query_execution_error', {
          message: (e as Error).message,
          query,
          database,
        });
        socket.emit('error', { message: (e as Error).message });
      }
    },
  );

  // ── ER Diagram / FK data ────────────────────────────────────────────────────
  socket.on('get_foreign_keys', async (database: string) => {
    const db = activeConnections.get(socket.id);
    if (!db) return socket.emit('error', { message: 'No active connection' });
    try {
      let fkData: ForeignKey[] = [];
      if (db.engine === 'postgresql') {
        const client = await db._pgGetClient(database);
        try {
          const result = await client.query(`
            SELECT
              tc.table_name   AS from_table,
              kcu.column_name AS from_column,
              ccu.table_name  AS to_table,
              ccu.column_name AS to_column,
              tc.constraint_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name
            JOIN information_schema.constraint_column_usage ccu
                ON tc.constraint_name = ccu.constraint_name
            WHERE tc.constraint_type = 'FOREIGN KEY'
          `);
          fkData = result.rows as ForeignKey[];
        } finally { await client.end(); }
      } else {
        const conn = db.connection as import('mysql2/promise').Connection;
        const [rows] = await conn.query(
          `SELECT
              TABLE_NAME          AS from_table,
              COLUMN_NAME         AS from_column,
              REFERENCED_TABLE_NAME AS to_table,
              REFERENCED_COLUMN_NAME AS to_column,
              CONSTRAINT_NAME     AS constraint_name
           FROM information_schema.KEY_COLUMN_USAGE
           WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
          [database],
        );
        fkData = rows as ForeignKey[];
      }
      socket.emit('foreign_keys', { database, fkData });
    } catch (e) {
      socket.emit('error', { message: (e as Error).message });
    }
  });

  // ── Schema Diff ─────────────────────────────────────────────────────────────
  socket.on(
    'diff_databases',
    async ({
      database1,
      database2,
    }: {
      database1: string;
      database2: string;
    }) => {
      const db = activeConnections.get(socket.id);
      if (!db) return socket.emit('error', { message: 'No active connection' });
      try {
        const [tables1, tables2] = await Promise.all([
          db.getTables(database1),
          db.getTables(database2),
        ]);
        const set1 = new Set(tables1);
        const set2 = new Set(tables2);
        const added = tables2.filter((t) => !set1.has(t));
        const removed = tables1.filter((t) => !set2.has(t));
        const common = tables1.filter((t) => set2.has(t));
        const modified: ModifiedTable[] = [];

        for (const table of common) {
          const [s1, s2] = await Promise.all([
            db.getTableStructure(database1, table),
            db.getTableStructure(database2, table),
          ]);
          const fields1 = new Map(
            s1.map((f) => [f['Field'] as string, f]),
          );
          const fields2 = new Map(
            s2.map((f) => [f['Field'] as string, f]),
          );
          const changes: ModifiedTable['changes'] = [];

          for (const [name, f] of fields1) {
            if (!fields2.has(name)) {
              changes.push({ type: 'removed_column', column: name });
            } else {
              const f2 = fields2.get(name)!;
              if (
                f['Type'] !== f2['Type'] ||
                f['Null'] !== f2['Null'] ||
                f['Default'] !== f2['Default']
              ) {
                changes.push({
                  type: 'modified_column',
                  column: name,
                  from: f as Record<string, unknown>,
                  to: f2 as Record<string, unknown>,
                });
              }
            }
          }
          for (const [name] of fields2) {
            if (!fields1.has(name)) {
              changes.push({ type: 'added_column', column: name });
            }
          }
          if (changes.length > 0) modified.push({ table, changes });
        }
        socket.emit('schema_diff', {
          database1,
          database2,
          added,
          removed,
          modified,
        });
      } catch (e) {
        socket.emit('error', { message: (e as Error).message });
      }
    },
  );

  // ── Slow Query Monitor ───────────────────────────────────────────────────────
  socket.on(
    'get_slow_queries',
    async ({
      database,
      limit = 20,
    }: {
      database: string;
      limit?: number;
    }) => {
      const db = activeConnections.get(socket.id);
      if (!db) return socket.emit('error', { message: 'No active connection' });
      try {
        let queries: SlowQuery[] = [];
        if (db.engine === 'postgresql') {
          try {
            const client = await db._pgGetClient(database);
            try {
              const result = await client.query(
                `SELECT query, calls, total_exec_time, mean_exec_time, rows
                 FROM pg_stat_statements
                 ORDER BY mean_exec_time DESC
                 LIMIT $1`,
                [limit],
              );
              queries = result.rows.map(
                (r: Record<string, unknown>) => ({
                  query: String(r['query']),
                  execCount: Number(r['calls']),
                  totalMs: parseFloat(String(r['total_exec_time'])).toFixed(2),
                  avgMs: parseFloat(String(r['mean_exec_time'])).toFixed(2),
                  rows: Number(r['rows']),
                }),
              );
            } finally { await client.end(); }
          } catch {
            socket.emit('slow_queries', {
              queries: [],
              warning:
                'pg_stat_statements extension not enabled. Run: CREATE EXTENSION pg_stat_statements;',
            });
            return;
          }
        } else {
          try {
            const conn = db.connection as import('mysql2/promise').Connection;
            const [rows] = await conn.query(
              `SELECT DIGEST_TEXT AS query, COUNT_STAR AS exec_count,
                      SUM_TIMER_WAIT/1000000000 AS total_ms,
                      AVG_TIMER_WAIT/1000000000 AS avg_ms,
                      SUM_ROWS_EXAMINED AS rows_examined
               FROM performance_schema.events_statements_summary_by_digest
               WHERE SCHEMA_NAME = ?
               ORDER BY avg_ms DESC
               LIMIT ?`,
              [database, limit],
            );
            queries = (rows as Array<Record<string, unknown>>).map((r) => ({
              query: String(r['query']),
              execCount: Number(r['exec_count']),
              totalMs: parseFloat(String(r['total_ms'])).toFixed(2),
              avgMs: parseFloat(String(r['avg_ms'])).toFixed(2),
              rows: Number(r['rows_examined']),
            }));
          } catch {
            socket.emit('slow_queries', {
              queries: [],
              warning:
                'performance_schema not available. Enable it in MySQL config with performance_schema=ON',
            });
            return;
          }
        }
        socket.emit('slow_queries', { queries });
      } catch (e) {
        socket.emit('error', { message: (e as Error).message });
      }
    },
  );
}
