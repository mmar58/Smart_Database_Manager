import mysql from 'mysql2/promise';
import { Client as PgClient } from 'pg';
import archiver from 'archiver';
import { PassThrough } from 'stream';
import type {
  DatabaseEngine,
  DbCredentials,
  SslConfig,
  SearchFilter,
  TableDataResult,
  QueryResult,
  ExportOptions,
  ExportResult,
  DatabaseSize,
  TableSize,
} from '../types';

// ─── Internal normalised SSL config ───────────────────────────────────────────

function buildSslConfig(
  ssl: DbCredentials['ssl'],
): Record<string, unknown> | undefined {
  if (!ssl) return undefined;
  if (typeof ssl === 'boolean') return ssl ? {} : undefined;
  const cfg: Record<string, unknown> = {
    rejectUnauthorized: ssl.rejectUnauthorized !== false,
  };
  if ((ssl as SslConfig).ca) cfg['ca'] = (ssl as SslConfig).ca;
  if ((ssl as SslConfig).cert) cfg['cert'] = (ssl as SslConfig).cert;
  if ((ssl as SslConfig).key) cfg['key'] = (ssl as SslConfig).key;
  return cfg;
}

// ─── Types used internally ────────────────────────────────────────────────────

/** Resolved MySQL credentials (compatible with mysql2) */
interface MySqlConfig {
  host: string;
  port: number;
  user?: string;
  password?: string;
  database?: string;
  connectTimeout: number;
  ssl?: Record<string, unknown>;
  multipleStatements?: boolean;
}

/** Resolved PostgreSQL base config (compatible with pg) */
interface PgBaseConfig {
  host: string;
  port: number;
  user?: string;
  password?: string;
  connectionTimeoutMillis?: number;
  ssl?: Record<string, unknown>;
}

// ─── DatabaseManager ──────────────────────────────────────────────────────────

export class DatabaseManager {
  public readonly engine: DatabaseEngine;
  private mysqlConfig: MySqlConfig;
  private pgBaseConfig: PgBaseConfig;
  public connection: mysql.Connection | PgClient | null = null;

  constructor(credentials: DbCredentials) {
    this.engine =
      credentials.engine === 'postgresql' ? 'postgresql' : 'mysql';

    const sslConfig = buildSslConfig(credentials.ssl);

    this.pgBaseConfig = {
      host: credentials.host ?? 'localhost',
      port: credentials.port ?? 5432,
      user: credentials.user ?? credentials.username,
      password: credentials.password,
      connectionTimeoutMillis: credentials.connectTimeout ?? 10000,
      ...(sslConfig && { ssl: sslConfig }),
    };

    this.mysqlConfig = {
      host: credentials.host ?? 'localhost',
      port:
        credentials.port ??
        (this.engine === 'postgresql' ? 5432 : 3306),
      user: credentials.user ?? credentials.username,
      password: credentials.password,
      database: credentials.database,
      connectTimeout: credentials.connectTimeout ?? 60000,
      ...(sslConfig && { ssl: sslConfig }),
    };
  }

  // ─── PostgreSQL helpers ─────────────────────────────────────────────────────

  /** Create a pg.Client connected to the given database. */
  public async _pgGetClient(database?: string): Promise<PgClient> {
    const dbName =
      database ?? this.mysqlConfig.database ?? 'postgres';
    const client = new PgClient({ ...this.pgBaseConfig, database: dbName });
    await client.connect();
    return client;
  }

  /** Double-quote a PostgreSQL identifier safely. */
  public _pgEscapeId(name: string): string {
    return '"' + String(name).replace(/"/g, '""') + '"';
  }

  /** Escape a literal value for use in exported SQL (NOT for parameterised queries). */
  public _pgEscapeLiteral(value: unknown): string {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'number') return value.toString();
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (typeof value === 'object')
      return "'" + JSON.stringify(value).replace(/'/g, "''") + "'";
    return "'" + String(value).replace(/'/g, "''") + "'";
  }

  // ─── MySQL helper ────────────────────────────────────────────────────────────

  private get mysqlConn(): mysql.Connection {
    return this.connection as mysql.Connection;
  }

  // ─── Connection ─────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.engine === 'postgresql') {
      console.log('Attempting PostgreSQL connection...');
      this.connection = await this._pgGetClient();
      console.log('PostgreSQL connected successfully');
    } else {
      console.log(
        this.mysqlConfig.ssl
          ? 'Attempting secure SSL connection to database...'
          : 'Attempting standard connection to database...',
      );
      this.connection = await mysql.createConnection(this.mysqlConfig);
      console.log(
        `Database connected successfully (${this.mysqlConfig.ssl ? 'SSL' : 'Non-SSL'})`,
      );
    }
  }

  async disconnect(): Promise<void> {
    if (this.connection) {
      await this.connection.end();
      this.connection = null;
      console.log('Database disconnected');
    }
  }

  // ─── Schema inspection ──────────────────────────────────────────────────────

  async getDatabases(): Promise<string[]> {
    if (!this.connection) throw new Error('No database connection');
    if (this.engine === 'postgresql') {
      const result = await (this.connection as PgClient).query(
        'SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname',
      );
      return result.rows.map((r: Record<string, string>) => r.datname);
    }
    const [rows] = await this.mysqlConn.execute('SHOW DATABASES');
    return (rows as Array<Record<string, string>>).map((r) => r['Database']);
  }

  async getTables(databaseName: string): Promise<string[]> {
    if (!this.connection) throw new Error('No database connection');
    if (this.engine === 'postgresql') {
      const client = await this._pgGetClient(databaseName);
      try {
        const result = await client.query(
          "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
        );
        return result.rows.map((r: Record<string, string>) => r.tablename);
      } finally {
        await client.end();
      }
    }
    const escapedDb = this.mysqlConn.escapeId(databaseName);
    const [rows] = await this.mysqlConn.query(`SHOW TABLES FROM ${escapedDb}`);
    const key = `Tables_in_${databaseName}`;
    return (rows as Array<Record<string, string>>).map((r) => r[key]);
  }

  async getTableStructure(
    databaseName: string,
    tableName: string,
  ): Promise<Record<string, unknown>[]> {
    if (!this.connection) throw new Error('No database connection');
    if (this.engine === 'postgresql') {
      const client = await this._pgGetClient(databaseName);
      try {
        const result = await client.query(
          `SELECT
              c.column_name AS "Field",
              c.data_type   AS "Type",
              c.is_nullable AS "Null",
              c.column_default AS "Default",
              CASE WHEN pk.column_name IS NOT NULL THEN 'PRI' ELSE '' END AS "Key",
              '' AS "Extra"
           FROM information_schema.columns c
           LEFT JOIN (
               SELECT ku.column_name
               FROM information_schema.table_constraints tc
               JOIN information_schema.key_column_usage ku
                   ON tc.constraint_name = ku.constraint_name
                   AND tc.table_schema   = ku.table_schema
                   AND tc.table_name     = ku.table_name
               WHERE tc.constraint_type = 'PRIMARY KEY'
                 AND tc.table_schema    = 'public'
                 AND tc.table_name      = $1
           ) pk ON c.column_name = pk.column_name
           WHERE c.table_schema = 'public' AND c.table_name = $1
           ORDER BY c.ordinal_position`,
          [tableName],
        );
        return result.rows;
      } finally {
        await client.end();
      }
    }
    const esc = this.mysqlConn.escapeId(databaseName);
    const escT = this.mysqlConn.escapeId(tableName);
    const [rows] = await this.mysqlConn.query(`DESCRIBE ${esc}.${escT}`);
    return rows as Record<string, unknown>[];
  }

  async getTableData(
    databaseName: string,
    tableName: string,
    limit = 100,
    offset = 0,
    sortColumn: string | null = null,
    sortDirection = 'ASC',
    searchFilters: SearchFilter[] | null = null,
    searchLogic = 'AND',
  ): Promise<TableDataResult> {
    if (!this.connection) throw new Error('No database connection');

    if (this.engine === 'postgresql') {
      const client = await this._pgGetClient(databaseName);
      try {
        const tableRef = `${this._pgEscapeId('public')}.${this._pgEscapeId(tableName)}`;
        const paramValues: unknown[] = [];
        let paramIndex = 1;
        let whereClause = '';

        if (searchFilters?.length) {
          const valid = searchFilters.filter((f) => f.column && f.value);
          if (valid.length) {
            const logic = searchLogic === 'OR' ? 'OR' : 'AND';
            const conditions = valid.map((f) => {
              const col = this._pgEscapeId(f.column);
              const op = f.operator === 'NOT LIKE' ? 'NOT ILIKE' : 'ILIKE';
              paramValues.push(`%${f.value}%`);
              return `${col}::text ${op} $${paramIndex++}`;
            });
            whereClause = ` WHERE ${conditions.join(` ${logic} `)}`;
          }
        }

        let orderClause = '';
        if (sortColumn) {
          const dir = sortDirection.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
          orderClause = ` ORDER BY ${this._pgEscapeId(sortColumn)} ${dir}`;
        }

        const countResult = await client.query(
          `SELECT COUNT(*) AS total FROM ${tableRef}${whereClause}`,
          paramValues,
        );
        const total = parseInt(countResult.rows[0].total as string, 10);

        const dataResult = await client.query(
          `SELECT * FROM ${tableRef}${whereClause}${orderClause} LIMIT ${parseInt(String(limit))} OFFSET ${parseInt(String(offset))}`,
          paramValues,
        );
        return {
          data: dataResult.rows,
          total,
          limit,
          offset,
          sortColumn,
          sortDirection,
          searchFilters,
          searchLogic,
        };
      } finally {
        await client.end();
      }
    }

    // MySQL
    const conn = this.mysqlConn;
    const escDb = conn.escapeId(databaseName);
    const escT = conn.escapeId(tableName);
    const full = `${escDb}.${escT}`;

    let whereClause = '';
    if (searchFilters?.length) {
      const valid = searchFilters.filter((f) => f.column && f.value);
      if (valid.length) {
        const logic = searchLogic === 'OR' ? 'OR' : 'AND';
        const conditions = valid.map((f) => {
          const col = conn.escapeId(f.column);
          const val = conn.escape(`%${f.value}%`);
          const op = f.operator === 'NOT LIKE' ? 'NOT LIKE' : 'LIKE';
          return `${col} ${op} ${val}`;
        });
        whereClause = ` WHERE ${conditions.join(` ${logic} `)}`;
      }
    }

    let orderClause = '';
    if (sortColumn) {
      const dir = sortDirection.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      orderClause = ` ORDER BY ${conn.escapeId(sortColumn)} ${dir}`;
    }

    const [countResult] = await conn.query(
      `SELECT COUNT(*) as total FROM ${full}${whereClause}`,
    );
    const total = (countResult as Array<Record<string, unknown>>)[0]['total'];

    const [rows] = await conn.query(
      `SELECT * FROM ${full}${whereClause}${orderClause} LIMIT ${parseInt(String(limit))} OFFSET ${parseInt(String(offset))}`,
    );
    return {
      data: rows as Record<string, unknown>[],
      total: typeof total === 'bigint' ? Number(total) : (total as number),
      limit,
      offset,
      sortColumn,
      sortDirection,
      searchFilters,
      searchLogic,
    };
  }

  async executeQuery(
    databaseName: string | null,
    query: string,
  ): Promise<QueryResult> {
    if (!this.connection) throw new Error('No database connection');

    if (this.engine === 'postgresql') {
      const client =
        databaseName && databaseName !== ''
          ? await this._pgGetClient(databaseName)
          : (this.connection as PgClient);
      const ownClient =
        databaseName !== '' && client !== this.connection;
      try {
        const statements = query
          .trim()
          .split(/;(?=(?:[^']*'[^']*')*[^']*$)/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        if (statements.length > 1) {
          const results: { statement: string; data: unknown[]; rowCount: number }[] = [];
          let totalAffected = 0;
          for (const stmt of statements) {
            const res = await client.query(stmt);
            const upper = stmt.trim().toUpperCase();
            if (
              upper.startsWith('SELECT') ||
              upper.startsWith('WITH') ||
              upper.startsWith('EXPLAIN')
            ) {
              results.push({ statement: stmt, data: res.rows, rowCount: res.rowCount ?? 0 });
            } else {
              totalAffected += res.rowCount ?? 0;
            }
          }
          if (results.length > 0) {
            return {
              type: 'SELECT',
              data: results,
              rowCount: results.reduce((t, r) => t + r.rowCount, 0),
              multipleStatements: true,
            };
          }
          return {
            type: 'MODIFY',
            affectedRows: totalAffected,
            insertId: null,
            message: `${statements.length} statements executed successfully`,
          };
        }

        const res = await client.query(query.trim());
        const upper = query.trim().toUpperCase();
        if (
          upper.startsWith('SELECT') ||
          upper.startsWith('WITH') ||
          upper.startsWith('EXPLAIN') ||
          upper.startsWith('SHOW')
        ) {
          return { type: 'SELECT', data: res.rows, rowCount: res.rowCount ?? 0 };
        }
        return {
          type: 'MODIFY',
          affectedRows: res.rowCount ?? 0,
          insertId: null,
          message: 'Query executed successfully',
        };
      } finally {
        if (ownClient) await client.end();
      }
    }

    // ── MySQL ────────────────────────────────────────────────────────────────
    let finalQuery = query.trim();
    const upperQuery = query.toUpperCase().trim();
    const conn = this.mysqlConn;

    if (upperQuery.startsWith('USE ')) {
      const dbMatch = query.match(/USE\s+`?(\w+)`?/i);
      if (dbMatch) {
        const testConn = await mysql.createConnection({
          ...this.mysqlConfig,
          database: dbMatch[1],
        });
        await testConn.end();
        return {
          type: 'MODIFY',
          affectedRows: 0,
          insertId: null,
          message: `Database changed to '${dbMatch[1]}'`,
        };
      }
    }

    const statements = finalQuery
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (statements.length > 1) {
      let totalAffectedRows = 0;
      const results: { statement: string; data: unknown[]; rowCount: number }[] = [];
      let lastInsertId: number | null = null;

      const execConn = databaseName
        ? await mysql.createConnection({
            ...this.mysqlConfig,
            database: databaseName,
            multipleStatements: true,
          })
        : conn;

      try {
        for (const statement of statements) {
          const [result] = await execConn.query(statement);
          const upper = statement.trim().toUpperCase();
          if (
            upper.startsWith('SELECT') ||
            upper.startsWith('SHOW') ||
            upper.startsWith('DESCRIBE') ||
            upper.startsWith('EXPLAIN')
          ) {
            const rows = result as unknown[];
            results.push({ statement, data: rows, rowCount: rows.length });
          } else {
            const res = result as mysql.ResultSetHeader;
            totalAffectedRows += res.affectedRows ?? 0;
            if (res.insertId) lastInsertId = res.insertId;
          }
        }
        if (results.length > 0) {
          return {
            type: 'SELECT',
            data: results,
            rowCount: results.reduce((t, r) => t + r.rowCount, 0),
            multipleStatements: true,
          };
        }
        return {
          type: 'MODIFY',
          affectedRows: totalAffectedRows,
          insertId: lastInsertId,
          message: `${statements.length} statements executed successfully`,
        };
      } finally {
        if (execConn !== conn) await execConn.end();
      }
    }

    if (databaseName) {
      if (upperQuery.startsWith('SHOW TABLES')) {
        finalQuery = `SHOW TABLES FROM ${conn.escapeId(databaseName)}`;
      } else {
        const dbConn = await mysql.createConnection({
          ...this.mysqlConfig,
          database: databaseName,
        });
        try {
          const [result] = await dbConn.query(finalQuery);
          if (
            finalQuery.trim().toUpperCase().startsWith('SELECT') ||
            finalQuery.trim().toUpperCase().startsWith('SHOW') ||
            finalQuery.trim().toUpperCase().startsWith('DESCRIBE') ||
            finalQuery.trim().toUpperCase().startsWith('EXPLAIN')
          ) {
            const rows = result as unknown[];
            return { type: 'SELECT', data: rows, rowCount: rows.length };
          }
          const res = result as mysql.ResultSetHeader;
          return {
            type: 'MODIFY',
            affectedRows: res.affectedRows ?? 0,
            insertId: res.insertId ?? null,
            message: 'Query executed successfully',
          };
        } finally {
          await dbConn.end();
        }
      }
    }

    const [result] = await conn.query(finalQuery);
    if (
      finalQuery.trim().toUpperCase().startsWith('SELECT') ||
      finalQuery.trim().toUpperCase().startsWith('SHOW') ||
      finalQuery.trim().toUpperCase().startsWith('DESCRIBE') ||
      finalQuery.trim().toUpperCase().startsWith('EXPLAIN')
    ) {
      const rows = result as unknown[];
      return { type: 'SELECT', data: rows, rowCount: rows.length };
    }
    const res = result as mysql.ResultSetHeader;
    return {
      type: 'MODIFY',
      affectedRows: res.affectedRows ?? 0,
      insertId: res.insertId ?? null,
      message: 'Query executed successfully',
    };
  }

  // ─── DDL ─────────────────────────────────────────────────────────────────────

  async createDatabase(databaseName: string): Promise<void> {
    if (!this.connection) throw new Error('No database connection');
    if (this.engine === 'postgresql') {
      await (this.connection as PgClient).query(
        `CREATE DATABASE ${this._pgEscapeId(databaseName)}`,
      );
    } else {
      await this.mysqlConn.query(
        `CREATE DATABASE ${this.mysqlConn.escapeId(databaseName)}`,
      );
    }
  }

  async dropDatabase(databaseName: string): Promise<void> {
    if (!this.connection) throw new Error('No database connection');
    if (this.engine === 'postgresql') {
      await (this.connection as PgClient).query(
        `DROP DATABASE IF EXISTS ${this._pgEscapeId(databaseName)}`,
      );
    } else {
      await this.mysqlConn.query(
        `DROP DATABASE ${this.mysqlConn.escapeId(databaseName)}`,
      );
    }
  }

  async createTable(databaseName: string, createTableQuery: string): Promise<void> {
    if (!this.connection) throw new Error('No database connection');
    if (this.engine === 'postgresql') {
      const client = await this._pgGetClient(databaseName);
      try { await client.query(createTableQuery); } finally { await client.end(); }
    } else {
      let q = createTableQuery;
      if (databaseName && !q.includes(`${databaseName}.`)) {
        q = q.replace(
          /CREATE TABLE\s+`?(\w+)`?/i,
          `CREATE TABLE \`${databaseName}\`.\`$1\``,
        );
      }
      await this.mysqlConn.execute(q);
    }
  }

  async dropTable(databaseName: string, tableName: string): Promise<void> {
    if (!this.connection) throw new Error('No database connection');
    if (this.engine === 'postgresql') {
      const client = await this._pgGetClient(databaseName);
      try {
        await client.query(
          `DROP TABLE IF EXISTS ${this._pgEscapeId('public')}.${this._pgEscapeId(tableName)}`,
        );
      } finally { await client.end(); }
    } else {
      const conn = this.mysqlConn;
      await conn.query(
        `DROP TABLE ${conn.escapeId(databaseName)}.${conn.escapeId(tableName)}`,
      );
    }
  }

  async alterTable(
    databaseName: string,
    tableName: string,
    alterQuery: string,
  ): Promise<void> {
    if (!this.connection) throw new Error('No database connection');
    if (this.engine === 'postgresql') {
      const client = await this._pgGetClient(databaseName);
      try { await client.query(alterQuery); } finally { await client.end(); }
    } else {
      const dbConn = await mysql.createConnection({
        ...this.mysqlConfig,
        database: databaseName,
      });
      try { await dbConn.query(alterQuery); } finally { await dbConn.end(); }
    }
  }

  // ─── Index / Constraint inspection ──────────────────────────────────────────

  async getTableIndexes(
    databaseName: string,
    tableName: string,
  ): Promise<Record<string, unknown>[]> {
    if (!this.connection) throw new Error('No database connection');
    if (this.engine === 'postgresql') {
      const client = await this._pgGetClient(databaseName);
      try {
        const result = await client.query(
          `SELECT
              i.relname AS "Key_name",
              a.attname AS "Column_name",
              NOT ix.indisunique AS "Non_unique",
              am.amname AS "Index_type",
              NULL AS "Cardinality"
           FROM pg_class t
           JOIN pg_index ix ON t.oid = ix.indrelid
           JOIN pg_class i  ON i.oid = ix.indexrelid
           JOIN pg_am am    ON i.relam = am.oid
           JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
           WHERE t.relname = $1 AND t.relkind = 'r'
           ORDER BY i.relname, a.attnum`,
          [tableName],
        );
        return result.rows;
      } finally { await client.end(); }
    }
    const conn = this.mysqlConn;
    const [rows] = await conn.query(
      `SHOW INDEX FROM ${conn.escapeId(databaseName)}.${conn.escapeId(tableName)}`,
    );
    return rows as Record<string, unknown>[];
  }

  async getTableConstraints(
    databaseName: string,
    tableName: string,
  ): Promise<Record<string, unknown>[]> {
    if (!this.connection) throw new Error('No database connection');
    if (this.engine === 'postgresql') {
      const client = await this._pgGetClient(databaseName);
      try {
        const result = await client.query(
          `SELECT
              tc.constraint_name AS "CONSTRAINT_NAME",
              tc.constraint_type AS "CONSTRAINT_TYPE",
              kcu.column_name    AS "COLUMN_NAME",
              ccu.table_name     AS "REFERENCED_TABLE_NAME",
              ccu.column_name    AS "REFERENCED_COLUMN_NAME"
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
               ON tc.constraint_name = kcu.constraint_name
               AND tc.table_schema   = kcu.table_schema
           LEFT JOIN information_schema.constraint_column_usage ccu
               ON tc.constraint_name = ccu.constraint_name
               AND tc.table_schema   = ccu.table_schema
           WHERE tc.table_schema = 'public' AND tc.table_name = $1
           ORDER BY kcu.ordinal_position`,
          [tableName],
        );
        return result.rows;
      } finally { await client.end(); }
    }
    const [rows] = await this.mysqlConn.query(
      `SELECT
          CONSTRAINT_NAME, CONSTRAINT_TYPE, COLUMN_NAME,
          REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
       JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
           ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
           AND kcu.TABLE_SCHEMA   = tc.TABLE_SCHEMA
       WHERE kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ?
       ORDER BY kcu.ORDINAL_POSITION`,
      [databaseName, tableName],
    );
    return rows as Record<string, unknown>[];
  }

  // ─── Export helpers ──────────────────────────────────────────────────────────

  public _buildExportWhereClause(options: ExportOptions = {}): string | null {
    const {
      whereClause = null,
      searchFilters = null,
      searchLogic = 'AND',
      selectedPKValues = null,
      pkColumn = null,
    } = options;

    if (whereClause) return whereClause;

    if (selectedPKValues && pkColumn && selectedPKValues.length > 0) {
      if (this.engine === 'postgresql') {
        const escaped = selectedPKValues
          .map((v) => this._pgEscapeLiteral(v))
          .join(', ');
        return `${this._pgEscapeId(pkColumn)} IN (${escaped})`;
      }
      const conn = this.mysqlConn;
      const escaped = selectedPKValues
        .map((v) => conn.escape(v))
        .join(', ');
      return `${conn.escapeId(pkColumn)} IN (${escaped})`;
    }

    if (searchFilters?.length) {
      const valid = searchFilters.filter(
        (f) => f.column && f.value !== undefined && f.value !== '',
      );
      if (valid.length) {
        const logic = searchLogic === 'OR' ? 'OR' : 'AND';
        if (this.engine === 'postgresql') {
          const conditions = valid.map((f) => {
            const col = this._pgEscapeId(f.column);
            const op = f.operator === 'NOT LIKE' ? 'NOT ILIKE' : 'ILIKE';
            const val = f.value.replace(/'/g, "''");
            return `${col}::text ${op} '%${val}%'`;
          });
          return conditions.join(` ${logic} `);
        }
        const conn = this.mysqlConn;
        const conditions = valid.map((f) => {
          const col = conn.escapeId(f.column);
          const val = conn.escape(`%${f.value}%`);
          const op = f.operator === 'NOT LIKE' ? 'NOT LIKE' : 'LIKE';
          return `${col} ${op} ${val}`;
        });
        return conditions.join(` ${logic} `);
      }
    }

    return null;
  }

  private async _exportTableAsJson(
    databaseName: string,
    tableName: string,
    options: ExportOptions = {},
  ): Promise<string> {
    const { includeData = true, selectedRows = null } = options;
    const whereClause = this._buildExportWhereClause(options);
    const result: {
      table: string;
      structure: unknown[];
      data: unknown[];
    } = { table: tableName, structure: [], data: [] };

    if (this.engine === 'postgresql') {
      const client = await this._pgGetClient(databaseName);
      try {
        const colsResult = await client.query(
          `SELECT column_name, data_type, is_nullable, column_default
           FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = $1
           ORDER BY ordinal_position`,
          [tableName],
        );
        result.structure = colsResult.rows;
        if (includeData) {
          let dataQuery = `SELECT * FROM ${this._pgEscapeId('public')}.${this._pgEscapeId(tableName)}`;
          if (whereClause) dataQuery += ` WHERE ${whereClause}`;
          const dataResult = await client.query(dataQuery);
          let rows: unknown[] = dataResult.rows;
          if (selectedRows) rows = rows.filter((_, i) => selectedRows.includes(i));
          result.data = rows;
        }
      } finally { await client.end(); }
    } else {
      const [columns] = await this.mysqlConn.query(
        `SHOW COLUMNS FROM \`${databaseName}\`.\`${tableName}\``,
      );
      result.structure = columns as unknown[];
      if (includeData) {
        let dataQuery = `SELECT * FROM \`${databaseName}\`.\`${tableName}\``;
        if (whereClause) dataQuery += ` WHERE ${whereClause}`;
        const [rows] = await this.mysqlConn.query(dataQuery);
        let dataRows: unknown[] = rows as unknown[];
        if (selectedRows) dataRows = dataRows.filter((_, i) => selectedRows.includes(i));
        result.data = dataRows;
      }
    }
    return JSON.stringify(result, null, 2);
  }

  // ─── Export ──────────────────────────────────────────────────────────────────

  async exportTable(
    databaseName: string,
    tableName: string,
    options: ExportOptions = {},
  ): Promise<string> {
    if (!this.connection) throw new Error('No database connection');
    const { includeData = true, selectedRows = null, format = 'sql' } = options;
    const whereClause = this._buildExportWhereClause(options);

    if (format === 'json') {
      return this._exportTableAsJson(databaseName, tableName, {
        ...options,
        whereClause,
      });
    }

    let sqlContent = '';

    if (this.engine === 'postgresql') {
      const client = await this._pgGetClient(databaseName);
      try {
        sqlContent += `-- Table structure for "${tableName}"\n`;
        sqlContent += `DROP TABLE IF EXISTS ${this._pgEscapeId(tableName)};\n`;

        const colsResult = await client.query(
          `SELECT column_name, data_type, character_maximum_length,
                  numeric_precision, numeric_scale, is_nullable, column_default
           FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = $1
           ORDER BY ordinal_position`,
          [tableName],
        );
        const pkResult = await client.query(
          `SELECT ku.column_name
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage ku
               ON tc.constraint_name = ku.constraint_name
               AND tc.table_schema   = ku.table_schema
           WHERE tc.constraint_type = 'PRIMARY KEY'
             AND tc.table_schema = 'public' AND tc.table_name = $1`,
          [tableName],
        );
        const pkColumns = new Set<string>(
          pkResult.rows.map((r: Record<string, string>) => r['column_name']),
        );

        const colDefs = colsResult.rows.map((c: Record<string, unknown>) => {
          let typeDef = String(c['data_type']);
          if (c['character_maximum_length'])
            typeDef += `(${c['character_maximum_length']})`;
          else if (c['numeric_precision'] && c['numeric_scale'])
            typeDef += `(${c['numeric_precision']},${c['numeric_scale']})`;
          let colDef = `  ${this._pgEscapeId(String(c['column_name']))} ${typeDef}`;
          if (c['is_nullable'] === 'NO') colDef += ' NOT NULL';
          if (c['column_default'] !== null)
            colDef += ` DEFAULT ${c['column_default']}`;
          return colDef;
        });

        if (pkColumns.size > 0) {
          const pkCols = [...pkColumns]
            .map((c) => this._pgEscapeId(c))
            .join(', ');
          colDefs.push(`  PRIMARY KEY (${pkCols})`);
        }
        sqlContent += `CREATE TABLE ${this._pgEscapeId(tableName)} (\n${colDefs.join(',\n')}\n);\n\n`;

        if (includeData) {
          sqlContent += `-- Data for table "${tableName}"\n`;
          let dataQuery = `SELECT * FROM ${this._pgEscapeId('public')}.${this._pgEscapeId(tableName)}`;
          if (whereClause) dataQuery += ` WHERE ${whereClause}`;
          const dataResult = await client.query(dataQuery);
          let rows: Record<string, unknown>[] = dataResult.rows;
          if (selectedRows) rows = rows.filter((_, i) => selectedRows.includes(i));
          if (rows.length > 0) {
            const cols = Object.keys(rows[0]);
            const colsList = cols.map((c) => this._pgEscapeId(c)).join(', ');
            const valueStrings = rows.map((row) => {
              const vals = cols.map((col) => this._pgEscapeLiteral(row[col]));
              return `(${vals.join(', ')})`;
            });
            sqlContent += `INSERT INTO ${this._pgEscapeId(tableName)} (${colsList}) VALUES\n`;
            sqlContent += valueStrings.join(',\n') + ';\n';
          }
        }
      } finally { await client.end(); }
      return sqlContent;
    }

    // MySQL
    let oldSqlMode: string | null = null;
    try {
      const [modeResult] = await this.mysqlConn.query(
        'SELECT @@SESSION.sql_mode as mode',
      );
      const modeRows = modeResult as Array<Record<string, string>>;
      if (modeRows?.length > 0) oldSqlMode = modeRows[0]['mode'];
      await this.mysqlConn.query("SET SESSION sql_mode = 'NO_AUTO_VALUE_ON_ZERO'");
    } catch (e) {
      console.warn('Warning: Failed to set safe SQL mode for export:', (e as Error).message);
    }

    try {
      sqlContent += `-- Table structure for \`${tableName}\`\n`;
      sqlContent += `DROP TABLE IF EXISTS \`${tableName}\`;\n`;

      const [createResult] = await this.mysqlConn.query(
        `SHOW CREATE TABLE \`${databaseName}\`.\`${tableName}\``,
      );
      sqlContent +=
        (createResult as Array<Record<string, string>>)[0]['Create Table'] +
        ';\n\n';

      if (includeData) {
        sqlContent += `-- Data for table \`${tableName}\`\n`;
        let dataQuery = `SELECT * FROM \`${databaseName}\`.\`${tableName}\``;
        if (whereClause) dataQuery += ` WHERE ${whereClause}`;
        const [rows] = await this.mysqlConn.query(dataQuery);
        let dataRows = rows as Array<Record<string, unknown>>;
        if (selectedRows)
          dataRows = dataRows.filter((_, i) => selectedRows.includes(i));

        if (dataRows.length > 0) {
          const columns = Object.keys(dataRows[0]);
          const columnsList = columns.map((c) => `\`${c}\``).join(', ');
          sqlContent += `LOCK TABLES \`${tableName}\` WRITE;\n`;
          sqlContent += `INSERT INTO \`${tableName}\` (${columnsList}) VALUES\n`;
          const valueStrings = dataRows.map((row) => {
            const values = columns.map((col) => {
              const value = row[col];
              if (value === null) return 'NULL';
              if (typeof value === 'object' && !(value instanceof Date)) {
                return this.mysqlConn.escape(JSON.stringify(value));
              }
              return this.mysqlConn.escape(value);
            });
            return `(${values.join(', ')})`;
          });
          sqlContent += valueStrings.join(',\n') + ';\n';
          sqlContent += 'UNLOCK TABLES;\n';
        }
      }
      return sqlContent;
    } finally {
      if (oldSqlMode !== null) {
        try {
          await this.mysqlConn.query('SET SESSION sql_mode = ?', [oldSqlMode]);
        } catch (e) {
          console.error('Error restoring SQL mode:', (e as Error).message);
        }
      }
    }
  }

  async exportTableDataOnly(
    databaseName: string,
    tableName: string,
    options: ExportOptions = {},
  ): Promise<string> {
    if (!this.connection) throw new Error('No database connection');
    const { selectedRows = null } = options;
    const whereClause =
      options.whereClause ?? this._buildExportWhereClause(options);
    let sqlContent = '';

    if (this.engine === 'postgresql') {
      const client = await this._pgGetClient(databaseName);
      try {
        sqlContent += `-- Data for table "${tableName}"\n`;
        let dataQuery = `SELECT * FROM ${this._pgEscapeId('public')}.${this._pgEscapeId(tableName)}`;
        if (whereClause) dataQuery += ` WHERE ${whereClause}`;
        const dataResult = await client.query(dataQuery);
        let rows: Record<string, unknown>[] = dataResult.rows;
        if (selectedRows) rows = rows.filter((_, i) => selectedRows.includes(i));
        if (rows.length > 0) {
          const cols = Object.keys(rows[0]);
          const colsList = cols.map((c) => this._pgEscapeId(c)).join(', ');
          const valueStrings = rows.map((row) => {
            const vals = cols.map((col) => this._pgEscapeLiteral(row[col]));
            return `(${vals.join(', ')})`;
          });
          sqlContent += `INSERT INTO ${this._pgEscapeId(tableName)} (${colsList}) VALUES\n`;
          sqlContent += valueStrings.join(',\n') + ';\n';
        }
      } finally { await client.end(); }
      return sqlContent;
    }

    sqlContent += `-- Data for table \`${tableName}\`\n`;
    let dataQuery = `SELECT * FROM \`${databaseName}\`.\`${tableName}\``;
    if (whereClause) dataQuery += ` WHERE ${whereClause}`;
    const [rows] = await this.mysqlConn.query(dataQuery);
    let dataRows = rows as Array<Record<string, unknown>>;
    if (selectedRows) dataRows = dataRows.filter((_, i) => selectedRows.includes(i));
    if (dataRows.length > 0) {
      const columns = Object.keys(dataRows[0]);
      const columnsList = columns.map((c) => `\`${c}\``).join(', ');
      sqlContent += `LOCK TABLES \`${tableName}\` WRITE;\n`;
      sqlContent += `INSERT INTO \`${tableName}\` (${columnsList}) VALUES\n`;
      const valueStrings = dataRows.map((row) => {
        const values = columns.map((col) => {
          const value = row[col];
          if (value === null) return 'NULL';
          if (typeof value === 'object' && !(value instanceof Date)) {
            return this.mysqlConn.escape(JSON.stringify(value));
          }
          return this.mysqlConn.escape(value);
        });
        return `(${values.join(', ')})`;
      });
      sqlContent += valueStrings.join(',\n') + ';\n';
      sqlContent += 'UNLOCK TABLES;\n';
    }
    return sqlContent;
  }

  async exportDatabase(
    databaseName: string,
    options: ExportOptions = {},
  ): Promise<ExportResult> {
    if (!this.connection) throw new Error('No database connection');
    const {
      includeData = true,
      selectedTables = null,
      exportMethod = 'single',
      separateData = false,
      format = 'sql',
    } = options;

    const tables = selectedTables ?? (await this.getTables(databaseName));
    const timestamp = new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/:/g, '-');
    const engineLabel =
      this.engine === 'postgresql' ? 'PostgreSQL' : 'MySQL';

    // ── JSON export ────────────────────────────────────────────────────────────
    if (format === 'json') {
      if (exportMethod === 'single') {
        const dbExport: {
          database: string;
          exported: string;
          engine: string;
          tables: Record<string, { structure: unknown[]; data: unknown[] }>;
        } = {
          database: databaseName,
          exported: new Date().toISOString(),
          engine: this.engine,
          tables: {},
        };
        for (const tbl of tables) {
          const parsed = JSON.parse(
            await this._exportTableAsJson(databaseName, tbl, { includeData }),
          ) as { structure: unknown[]; data: unknown[] };
          dbExport.tables[tbl] = { structure: parsed.structure, data: parsed.data };
        }
        const jsonContent = JSON.stringify(dbExport, null, 2);
        return {
          filename: `${databaseName}_export_${timestamp}.json`,
          content: jsonContent,
          size: Buffer.byteLength(jsonContent, 'utf8'),
          isZip: false,
        };
      }
      // JSON split — one file per table in a ZIP
      return new Promise((resolve, reject) => {
        const archive = archiver('zip', { zlib: { level: 9 } });
        const chunks: Buffer[] = [];
        const output = new PassThrough();
        output.on('data', (c: Buffer) => chunks.push(c));
        output.on('end', () => {
          const buf = Buffer.concat(chunks);
          resolve({
            filename: `${databaseName}_export_${timestamp}.zip`,
            content: buf,
            size: buf.length,
            isZip: true,
          });
        });
        archive.on('error', reject);
        archive.pipe(output);
        (async () => {
          for (const tbl of tables) {
            const tJson = await this._exportTableAsJson(databaseName, tbl, {
              includeData,
            });
            archive.append(tJson, { name: `${tbl}.json` });
          }
          await archive.finalize();
        })().catch(reject);
      });
    }

    // ── SQL single (no zip) ────────────────────────────────────────────────────
    if (exportMethod === 'single' && !separateData) {
      let sqlContent = `-- Database Export: ${databaseName}\n`;
      sqlContent += `-- Generated on: ${new Date().toISOString()}\n`;
      sqlContent += `-- ${engineLabel} Database Manager Export\n\n`;
      if (this.engine === 'postgresql') {
        sqlContent += '-- Connect to the target database before running these statements\n\n';
      } else {
        sqlContent += `CREATE DATABASE IF NOT EXISTS \`${databaseName}\`;\n`;
        sqlContent += `USE \`${databaseName}\`;\n\n`;
      }
      for (const tbl of tables) {
        sqlContent += await this.exportTable(databaseName, tbl, { includeData });
        sqlContent += '\n';
      }
      return {
        filename: `${databaseName}_export_${timestamp}.sql`,
        content: sqlContent,
        size: Buffer.byteLength(sqlContent, 'utf8'),
        isZip: false,
      };
    }

    // ── SQL ZIP variants ───────────────────────────────────────────────────────
    return new Promise((resolve, reject) => {
      const archive = archiver('zip', { zlib: { level: 9 } });
      const chunks: Buffer[] = [];
      const output = new PassThrough();
      output.on('data', (c: Buffer) => chunks.push(c));
      output.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({
          filename: `${databaseName}_export_${timestamp}.zip`,
          content: buf,
          size: buf.length,
          isZip: true,
        });
      });
      archive.on('error', reject);
      archive.pipe(output);
      archive.append(
        `Database Export: ${databaseName}\nGenerated on: ${new Date().toISOString()}\n`,
        { name: 'info.txt' },
      );

      (async () => {
        if (exportMethod === 'single' && separateData) {
          let structureContent =
            this.engine === 'postgresql'
              ? '-- Connect to the target database before running\n\n'
              : `CREATE DATABASE IF NOT EXISTS \`${databaseName}\`;\nUSE \`${databaseName}\`;\n\n`;
          let dataContent =
            this.engine === 'postgresql'
              ? '-- Data export\n\n'
              : `USE \`${databaseName}\`;\n\n`;
          for (const tbl of tables) {
            structureContent +=
              (await this.exportTable(databaseName, tbl, { includeData: false })) + '\n';
            if (includeData) {
              dataContent +=
                (await this.exportTableDataOnly(databaseName, tbl)) + '\n';
            }
          }
          archive.append(structureContent, { name: 'structure.sql' });
          if (includeData) archive.append(dataContent, { name: 'data.sql' });
        } else if (exportMethod === 'split') {
          for (const tbl of tables) {
            if (separateData) {
              archive.append(
                await this.exportTable(databaseName, tbl, { includeData: false }),
                { name: `${tbl}_structure.sql` },
              );
              if (includeData) {
                archive.append(
                  await this.exportTableDataOnly(databaseName, tbl),
                  { name: `${tbl}_data.sql` },
                );
              }
            } else {
              archive.append(
                await this.exportTable(databaseName, tbl, { includeData }),
                { name: `${tbl}.sql` },
              );
            }
          }
        }
        await archive.finalize();
      })().catch(reject);
    });
  }

  // ─── DML ─────────────────────────────────────────────────────────────────────

  async updateRow(
    databaseName: string,
    tableName: string,
    primaryKeyColumn: string,
    primaryKeyValue: unknown,
    updateData: Record<string, unknown>,
  ): Promise<void> {
    if (!this.connection) throw new Error('No database connection');
    const columns = Object.keys(updateData);
    if (columns.length === 0) return;

    if (this.engine === 'postgresql') {
      const client = await this._pgGetClient(databaseName);
      try {
        const tableRef = `${this._pgEscapeId('public')}.${this._pgEscapeId(tableName)}`;
        const values = columns.map((col) => updateData[col]);
        let paramIdx = 1;
        const setClauses = columns.map(
          (col) => `${this._pgEscapeId(col)} = $${paramIdx++}`,
        );
        values.push(primaryKeyValue);
        await client.query(
          `UPDATE ${tableRef} SET ${setClauses.join(', ')} WHERE ${this._pgEscapeId(primaryKeyColumn)} = $${paramIdx}`,
          values,
        );
      } finally { await client.end(); }
      return;
    }

    const conn = this.mysqlConn;
    const setClauses = columns.map(
      (col) => `${conn.escapeId(col)} = ?`,
    );
    const values: unknown[] = columns.map((col) => updateData[col]);
    values.push(primaryKeyValue);
    const pkChanged =
      columns.includes(primaryKeyColumn) &&
      updateData[primaryKeyColumn] != primaryKeyValue;
    const query = `UPDATE ${conn.escapeId(databaseName)}.${conn.escapeId(tableName)} SET ${setClauses.join(', ')} WHERE ${conn.escapeId(primaryKeyColumn)} = ?`;
    if (pkChanged) {
      await conn.query('SET FOREIGN_KEY_CHECKS=0');
      try { await conn.execute(query, values); } finally {
        await conn.query('SET FOREIGN_KEY_CHECKS=1');
      }
    } else {
      await conn.execute(query, values);
    }
  }

  async deleteAllData(databaseName: string, tableName: string): Promise<void> {
    if (!this.connection) throw new Error('No database connection');
    if (this.engine === 'postgresql') {
      const client = await this._pgGetClient(databaseName);
      try {
        await client.query(
          `TRUNCATE TABLE ${this._pgEscapeId('public')}.${this._pgEscapeId(tableName)}`,
        );
      } finally { await client.end(); }
      return;
    }
    const conn = this.mysqlConn;
    const ref = `${conn.escapeId(databaseName)}.${conn.escapeId(tableName)}`;
    try {
      await conn.query(`TRUNCATE TABLE ${ref}`);
    } catch {
      await conn.query(`DELETE FROM ${ref}`);
    }
  }

  async deleteRows(
    databaseName: string,
    tableName: string,
    targetColumn: string,
    targetValues: unknown[],
  ): Promise<void> {
    if (!this.connection) throw new Error('No database connection');
    if (!Array.isArray(targetValues) || targetValues.length === 0)
      throw new Error('No rows specified for deletion');

    if (this.engine === 'postgresql') {
      const client = await this._pgGetClient(databaseName);
      try {
        const tableRef = `${this._pgEscapeId('public')}.${this._pgEscapeId(tableName)}`;
        const col = this._pgEscapeId(targetColumn);
        const placeholders = targetValues.map((_, i) => `$${i + 1}`).join(', ');
        await client.query(
          `DELETE FROM ${tableRef} WHERE ${col} IN (${placeholders})`,
          targetValues,
        );
      } finally { await client.end(); }
      return;
    }

    const conn = this.mysqlConn;
    const ref = `${conn.escapeId(databaseName)}.${conn.escapeId(tableName)}`;
    const col = conn.escapeId(targetColumn);
    const placeholders = targetValues.map(() => '?').join(',');
    await conn.query(
      `DELETE FROM ${ref} WHERE ${col} IN (${placeholders})`,
      targetValues,
    );
  }

  async getRowCount(
    databaseName: string,
    tableName: string,
    whereClause: string | null = null,
  ): Promise<number> {
    if (!this.connection) throw new Error('No database connection');
    if (this.engine === 'postgresql') {
      const client = await this._pgGetClient(databaseName);
      try {
        const tableRef = `${this._pgEscapeId('public')}.${this._pgEscapeId(tableName)}`;
        let query = `SELECT COUNT(*) AS count FROM ${tableRef}`;
        if (whereClause) query += ` WHERE ${whereClause}`;
        const result = await client.query(query);
        return parseInt(result.rows[0].count as string, 10);
      } finally { await client.end(); }
    }
    let query = `SELECT COUNT(*) as count FROM \`${databaseName}\`.\`${tableName}\``;
    if (whereClause) query += ` WHERE ${whereClause}`;
    const [result] = await this.mysqlConn.query(query);
    return (result as Array<Record<string, number>>)[0]['count'];
  }

  async insertRow(
    databaseName: string,
    tableName: string,
    rowData: Record<string, unknown>,
  ): Promise<void> {
    if (!this.connection) throw new Error('No database connection');
    const columns = Object.keys(rowData);
    if (columns.length === 0) return;

    if (this.engine === 'postgresql') {
      const client = await this._pgGetClient(databaseName);
      try {
        const tableRef = `${this._pgEscapeId('public')}.${this._pgEscapeId(tableName)}`;
        const colsList = columns.map((c) => this._pgEscapeId(c)).join(', ');
        const values = columns.map((col) => rowData[col]);
        let paramIdx = 1;
        const placeholders = columns.map(() => `$${paramIdx++}`).join(', ');
        await client.query(
          `INSERT INTO ${tableRef} (${colsList}) VALUES (${placeholders})`,
          values,
        );
      } finally { await client.end(); }
      return;
    }

    const conn = this.mysqlConn;
    const colsList = columns.map((c) => conn.escapeId(c)).join(', ');
    const placeholders = columns.map(() => '?').join(', ');
    const values = columns.map((col) => rowData[col]);
    await conn.execute(
      `INSERT INTO ${conn.escapeId(databaseName)}.${conn.escapeId(tableName)} (${colsList}) VALUES (${placeholders})`,
      values,
    );
  }

  // ─── Import ──────────────────────────────────────────────────────────────────

  async importDatabase(
    databaseName: string,
    sqlContent: string,
  ): Promise<void> {
    if (!this.connection) throw new Error('No database connection');
    await this.executeQuery(databaseName, sqlContent);
  }

  async importDatabaseFromJson(
    databaseName: string,
    jsonContent: string | Record<string, unknown>,
  ): Promise<void> {
    if (!this.connection) throw new Error('No database connection');
    const data =
      typeof jsonContent === 'string'
        ? (JSON.parse(jsonContent) as Record<string, unknown>)
        : jsonContent;

    if (data?.tables && typeof data.tables === 'object') {
      for (const [tableName, tableData] of Object.entries(
        data.tables as Record<string, { data?: Record<string, unknown>[] }>,
      )) {
        if (tableData?.data?.length) {
          for (const row of tableData.data) {
            try {
              await this.insertRow(databaseName, tableName, row);
            } catch (err) {
              console.error(`Error inserting row into ${tableName}:`, (err as Error).message);
            }
          }
        }
      }
    }
  }

  // ─── Size metrics ────────────────────────────────────────────────────────────

  async getDatabaseSizes(): Promise<DatabaseSize[]> {
    if (!this.connection) throw new Error('No database connection');
    try {
      if (this.engine === 'postgresql') {
        const result = await (this.connection as PgClient).query(
          `SELECT datname as database, pg_database_size(datname) as size_bytes
           FROM pg_database WHERE datistemplate = false`,
        );
        return result.rows.map((row: Record<string, unknown>) => ({
          database: String(row['database']),
          sizeMb: (parseInt(String(row['size_bytes']), 10) / 1024 / 1024).toFixed(2),
        }));
      }
      const [rows] = await this.mysqlConn.query(
        `SELECT table_schema AS 'database',
                SUM(data_length + index_length) AS 'size_bytes'
         FROM information_schema.tables
         GROUP BY table_schema`,
      );
      return (rows as Array<Record<string, unknown>>).map((row) => ({
        database: String(row['database']),
        sizeMb: (Number(row['size_bytes']) / 1024 / 1024).toFixed(2),
      }));
    } catch (e) {
      console.error('Failed to get database sizes:', (e as Error).message);
      return [];
    }
  }

  async getTableSizes(databaseName: string): Promise<TableSize[]> {
    if (!this.connection) throw new Error('No database connection');
    try {
      if (this.engine === 'postgresql') {
        const client = await this._pgGetClient(databaseName);
        try {
          const result = await client.query(
            `SELECT relname as table_name, pg_total_relation_size(C.oid) as size_bytes
             FROM pg_class C LEFT JOIN pg_namespace N ON (N.oid = C.relnamespace)
             WHERE nspname NOT IN ('pg_catalog','information_schema')
               AND C.relkind <> 'i' AND nspname !~ '^pg_toast'`,
          );
          return result.rows.map((row: Record<string, unknown>) => ({
            table: String(row['table_name']),
            sizeMb: (parseInt(String(row['size_bytes']), 10) / 1024 / 1024).toFixed(2),
          }));
        } finally { await client.end(); }
      }
      const [rows] = await this.mysqlConn.query(
        `SELECT table_name, (data_length + index_length) AS size_bytes
         FROM information_schema.tables
         WHERE table_schema = ?`,
        [databaseName],
      );
      return (rows as Array<Record<string, unknown>>).map((row) => ({
        table: String(row['table_name']),
        sizeMb: (Number(row['size_bytes']) / 1024 / 1024).toFixed(2),
      }));
    } catch (e) {
      console.error('Failed to get table sizes:', (e as Error).message);
      return [];
    }
  }
}

export default DatabaseManager;
