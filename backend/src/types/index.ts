// ============================================================
//  Shared TypeScript types for the DB Manager backend
// ============================================================

/** Supported database engines */
export type DatabaseEngine = 'mysql' | 'postgresql';

/** SSL configuration passed by the client */
export interface SslConfig {
  rejectUnauthorized?: boolean;
  ca?: string;
  cert?: string;
  key?: string;
}

/** Raw credentials from the client / backup profile */
export interface DbCredentials {
  host?: string;
  port?: number;
  user?: string;
  /** Alias accepted from the frontend */
  username?: string;
  password?: string;
  database?: string;
  ssl?: SslConfig | boolean | undefined;
  engine?: DatabaseEngine;
  connectTimeout?: number;
}

/** A single column search filter */
export interface SearchFilter {
  column: string;
  value: string;
  operator?: 'LIKE' | 'NOT LIKE';
}

/** Result returned by getTableData */
export interface TableDataResult {
  data: Record<string, unknown>[];
  total: number;
  limit: number;
  offset: number;
  sortColumn: string | null;
  sortDirection: string;
  searchFilters: SearchFilter[] | null;
  searchLogic: string;
}

/** Result returned by executeQuery */
export interface QueryResult {
  type: 'SELECT' | 'MODIFY';
  data?: unknown[];
  rowCount?: number;
  affectedRows?: number;
  insertId?: number | null;
  message?: string;
  multipleStatements?: boolean;
}

/** Multi-statement SELECT result element */
export interface StatementResult {
  statement: string;
  data: unknown[];
  rowCount: number;
}

/** Options passed to export methods */
export interface ExportOptions {
  includeData?: boolean;
  selectedTables?: string[] | null;
  exportMethod?: 'single' | 'split';
  separateData?: boolean;
  format?: 'sql' | 'json';
  selectedRows?: number[] | null;
  whereClause?: string | null;
  searchFilters?: SearchFilter[] | null;
  searchLogic?: string;
  selectedPKValues?: unknown[] | null;
  pkColumn?: string | null;
}

/** Result returned by exportDatabase / exportTable */
export interface ExportResult {
  filename: string;
  content: string | Buffer;
  size: number;
  isZip: boolean;
}

/** Auto-backup profile stored in settings */
export interface BackupProfile {
  id?: string;
  name: string;
  enabled: boolean;
  databases: string[];
  credentials: DbCredentials;
  credentialKey?: string;
  cpuLimit?: number;
  retention?: number;
  interval?: 'hourly' | 'daily' | 'weekly' | 'custom';
  cronExpression?: string;
}

/** Metadata for a backup file on disk */
export interface BackupFile {
  name: string;
  size: number;
  date: Date;
  meta: string | null;
}

/** Annotation entry */
export interface Annotation {
  note: string;
  updatedAt: string;
}

/** Annotations map: key → Annotation */
export type AnnotationsMap = Record<string, Annotation>;

/** Application settings stored in settings.json */
export interface AppSettings {
  backupProfiles?: BackupProfile[];
  [key: string]: unknown;
}

/** Query history entry */
export interface QueryHistoryEntry {
  query: string;
  database?: string;
  timestamp: string;
  [key: string]: unknown;
}

/** Server connection stored in server_connections.enc */
export interface ServerConnection {
  ipRestriction: 'all' | 'current' | 'selected';
  savedIp?: string;
  selectedIps?: string[];
  [key: string]: unknown;
}

/** Server connections map: id → ServerConnection */
export type ServerConnectionsMap = Record<string, ServerConnection>;

/** System stats returned by /api/system-stats */
export interface SystemStats {
  cpuUsage: number;
  memUsage: string;
  totalMem: string;
  usedMem: string;
  cpuModel: string;
  cpuCount: number;
  platform: string;
  uptime: number;
}

/** Previous CPU times for differential CPU usage calculation */
export interface CpuSnapshot {
  idle: number;
  total: number;
}

/** Slow query entry */
export interface SlowQuery {
  query: string;
  execCount: number;
  totalMs: string;
  avgMs: string;
  rows: number;
}

/** Schema diff change */
export interface SchemaChange {
  type: 'added_column' | 'removed_column' | 'modified_column';
  column: string;
  from?: Record<string, unknown>;
  to?: Record<string, unknown>;
}

/** Schema diff table entry */
export interface ModifiedTable {
  table: string;
  changes: SchemaChange[];
}

/** Foreign key relationship */
export interface ForeignKey {
  from_table: string;
  from_column: string;
  to_table: string;
  to_column: string;
  constraint_name: string;
}

/** Database size entry */
export interface DatabaseSize {
  database: string;
  sizeMb: string;
}

/** Table size entry */
export interface TableSize {
  table: string;
  sizeMb: string;
}

/** JWT payload stored in token */
export interface JwtPayload {
  host?: string;
  port?: number;
  username?: string;
  database?: string;
  ssl?: boolean | SslConfig;
  engine?: DatabaseEngine;
  iat?: number;
  exp?: number;
}

/** Credential store file format */
export type CredentialsStore = Record<string, string>;
