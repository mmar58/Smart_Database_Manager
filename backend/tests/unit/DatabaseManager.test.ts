import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatabaseManager } from '../../src/database/DatabaseManager';

// ─── Mock mysql2/promise and pg ───────────────────────────────────────────────
vi.mock('mysql2/promise', () => {
  const mockConn = {
    query: vi.fn(),
    execute: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
    escape: vi.fn((v: unknown) => `'${v}'`),
    escapeId: vi.fn((id: string) => `\`${id}\``),
  };
  return {
    default: {
      createConnection: vi.fn().mockResolvedValue(mockConn),
    },
    __mockConn: mockConn,
  };
});

vi.mock('pg', () => {
  const mockClient = {
    connect: vi.fn().mockResolvedValue(undefined),
    query: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
  };
  return { Client: vi.fn().mockImplementation(() => mockClient), __mockClient: mockClient };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function mysqlManager() {
  return new DatabaseManager({
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: 'pass',
    engine: 'mysql',
  });
}

function pgManager() {
  return new DatabaseManager({
    host: 'localhost',
    port: 5432,
    user: 'pg',
    password: 'pass',
    engine: 'postgresql',
  });
}

// ─── Constructor ──────────────────────────────────────────────────────────────
describe('DatabaseManager – constructor', () => {
  it('sets engine to mysql by default', () => {
    const dm = new DatabaseManager({});
    expect(dm.engine).toBe('mysql');
  });

  it('sets engine to postgresql when specified', () => {
    const dm = pgManager();
    expect(dm.engine).toBe('postgresql');
  });
});

// ─── connect / disconnect ─────────────────────────────────────────────────────
describe('DatabaseManager – connect / disconnect', () => {
  beforeEach(() => vi.clearAllMocks());

  it('MySQL: calls mysql.createConnection and sets connection', async () => {
    const dm = mysqlManager();
    await dm.connect();
    expect(dm.connection).not.toBeNull();
  });

  it('MySQL: disconnect calls end() and nulls connection', async () => {
    const dm = mysqlManager();
    await dm.connect();
    await dm.disconnect();
    expect(dm.connection).toBeNull();
  });

  it('disconnect on already-disconnected manager does nothing', async () => {
    const dm = mysqlManager();
    await expect(dm.disconnect()).resolves.toBeUndefined();
  });
});

// ─── getDatabases ─────────────────────────────────────────────────────────────
describe('DatabaseManager – getDatabases', () => {
  beforeEach(() => vi.clearAllMocks());

  it('MySQL: maps Database column from SHOW DATABASES', async () => {
    const mysql = await import('mysql2/promise');
    const mockConn = (mysql as unknown as { __mockConn: Record<string, ReturnType<typeof vi.fn>> }).__mockConn;
    mockConn['execute'].mockResolvedValueOnce([[{ Database: 'alpha' }, { Database: 'beta' }]]);

    const dm = mysqlManager();
    await dm.connect();
    const dbs = await dm.getDatabases();
    expect(dbs).toEqual(['alpha', 'beta']);
  });

  it('throws when no connection', async () => {
    const dm = mysqlManager();
    await expect(dm.getDatabases()).rejects.toThrow('No database connection');
  });
});

// ─── _pgEscapeId ─────────────────────────────────────────────────────────────
describe('DatabaseManager – _pgEscapeId', () => {
  it('wraps identifier in double quotes', () => {
    const dm = pgManager();
    expect(dm._pgEscapeId('my_table')).toBe('"my_table"');
  });

  it('escapes embedded double-quote characters', () => {
    const dm = pgManager();
    expect(dm._pgEscapeId('tab"le')).toBe('"tab""le"');
  });
});

// ─── _pgEscapeLiteral ────────────────────────────────────────────────────────
describe('DatabaseManager – _pgEscapeLiteral', () => {
  const dm = pgManager();

  it('returns NULL for null', () => expect(dm._pgEscapeLiteral(null)).toBe('NULL'));
  it('returns NULL for undefined', () => expect(dm._pgEscapeLiteral(undefined)).toBe('NULL'));
  it('returns numeric string unchanged', () => expect(dm._pgEscapeLiteral(42)).toBe('42'));
  it('wraps string in single quotes', () => expect(dm._pgEscapeLiteral('hello')).toBe("'hello'"));
  it("escapes embedded single-quotes", () => expect(dm._pgEscapeLiteral("o'hara")).toBe("'o''hara'"));
  it('returns TRUE for boolean true', () => expect(dm._pgEscapeLiteral(true)).toBe('TRUE'));
  it('returns FALSE for boolean false', () => expect(dm._pgEscapeLiteral(false)).toBe('FALSE'));
  it('JSON-encodes objects', () => {
    expect(dm._pgEscapeLiteral({ a: 1 })).toBe("'{\"a\":1}'");
  });
});

// ─── _buildExportWhereClause ─────────────────────────────────────────────────
describe('DatabaseManager – _buildExportWhereClause', () => {
  it('returns null when no options given', () => {
    const dm = pgManager();
    expect(dm._buildExportWhereClause()).toBeNull();
  });

  it('returns passed whereClause directly', () => {
    const dm = pgManager();
    expect(dm._buildExportWhereClause({ whereClause: 'id > 5' })).toBe('id > 5');
  });

  it('builds IN clause from selectedPKValues (PostgreSQL)', () => {
    const dm = pgManager();
    const result = dm._buildExportWhereClause({
      selectedPKValues: [1, 2, 3],
      pkColumn: 'id',
    });
    expect(result).toContain('IN (1, 2, 3)');
    expect(result).toContain('"id"');
  });

  it('builds LIKE clause from searchFilters (PostgreSQL)', () => {
    const dm = pgManager();
    const result = dm._buildExportWhereClause({
      searchFilters: [{ column: 'name', value: 'alice' }],
    });
    expect(result).toContain('ILIKE');
    expect(result).toContain('alice');
  });
});
