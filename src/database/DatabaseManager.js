const mysql = require('mysql2/promise');
const { Client: PgClient } = require('pg');
const archiver = require('archiver');
const { PassThrough } = require('stream');

class DatabaseManager {
    constructor(credentials) {
        this.engine = credentials.engine || 'mysql';

        const sslConfig = credentials.ssl ? {
            rejectUnauthorized: credentials.ssl.rejectUnauthorized !== false,
            ...(credentials.ssl.ca && { ca: credentials.ssl.ca }),
            ...(credentials.ssl.cert && { cert: credentials.ssl.cert }),
            ...(credentials.ssl.key && { key: credentials.ssl.key })
        } : undefined;

        if (this.engine === 'postgresql') {
            this.pgBaseConfig = {
                host: credentials.host || 'localhost',
                port: credentials.port || 5432,
                user: credentials.user,
                password: credentials.password,
                ...(sslConfig && { ssl: sslConfig })
            };
        }

        this.credentials = {
            host: credentials.host || 'localhost',
            port: credentials.port || (this.engine === 'postgresql' ? 5432 : 3306),
            user: credentials.user,
            password: credentials.password,
            database: credentials.database,
            connectTimeout: 60000,
            ...(sslConfig && { ssl: sslConfig })
        };

        this.connection = null;
    }

    // ─── PostgreSQL helpers ───────────────────────────────────────────────────

    /** Create a pg.Client connected to the given database */
    async _pgGetClient(database) {
        const dbName = database || this.credentials.database || 'postgres';
        const client = new PgClient({ ...this.pgBaseConfig, database: dbName });
        await client.connect();
        return client;
    }

    /** Double-quote a PostgreSQL identifier safely */
    _pgEscapeId(name) {
        return '"' + String(name).replace(/"/g, '""') + '"';
    }

    /** Escape a literal value for use in exported SQL (not for parameterised queries) */
    _pgEscapeLiteral(value) {
        if (value === null || value === undefined) return 'NULL';
        if (typeof value === 'number') return value.toString();
        if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
        if (typeof value === 'object') return "'" + JSON.stringify(value).replace(/'/g, "''") + "'";
        return "'" + String(value).replace(/'/g, "''") + "'";
    }

    // ─── Connection ───────────────────────────────────────────────────────────

    async connect() {
        try {
            if (this.engine === 'postgresql') {
                console.log('Attempting PostgreSQL connection...');
                // Connect to the initial database to list all databases
                this.connection = await this._pgGetClient();
                console.log('PostgreSQL connected successfully');
            } else {
                if (this.credentials.ssl) {
                    console.log('Attempting secure SSL connection to database...');
                } else {
                    console.log('Attempting standard connection to database...');
                }
                this.connection = await mysql.createConnection(this.credentials);
                console.log(`Database connected successfully (${this.credentials.ssl ? 'SSL' : 'Non-SSL'})`);
            }
        } catch (error) {
            console.error('Database connection failed:', error.message);
            throw error;
        }
    }

    async disconnect() {
        if (this.connection) {
            await this.connection.end();
            this.connection = null;
            console.log('Database disconnected');
        }
    }

    async getDatabases() {
        if (!this.connection) throw new Error('No database connection');

        try {
            if (this.engine === 'postgresql') {
                const result = await this.connection.query(
                    "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname"
                );
                return result.rows.map(r => r.datname);
            } else {
                const [rows] = await this.connection.execute('SHOW DATABASES');
                return rows.map(row => row.Database);
            }
        } catch (error) {
            throw new Error(`Failed to get databases: ${error.message}`);
        }
    }

    async getTables(databaseName) {
        if (!this.connection) throw new Error('No database connection');

        try {
            if (this.engine === 'postgresql') {
                const client = await this._pgGetClient(databaseName);
                try {
                    const result = await client.query(
                        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
                    );
                    return result.rows.map(r => r.tablename);
                } finally {
                    await client.end();
                }
            } else {
                const escapedDatabase = this.connection.escapeId(databaseName);
                const [rows] = await this.connection.query(`SHOW TABLES FROM ${escapedDatabase}`);
                const tableKey = `Tables_in_${databaseName}`;
                return rows.map(row => row[tableKey]);
            }
        } catch (error) {
            throw new Error(`Failed to get tables: ${error.message}`);
        }
    }

    async getTableStructure(databaseName, tableName) {
        if (!this.connection) throw new Error('No database connection');

        try {
            if (this.engine === 'postgresql') {
                const client = await this._pgGetClient(databaseName);
                try {
                    const result = await client.query(
                        `SELECT
                            c.column_name AS "Field",
                            c.data_type AS "Type",
                            c.is_nullable AS "Null",
                            c.column_default AS "Default",
                            CASE 
                                WHEN pk.column_name IS NOT NULL THEN 'PRI' 
                                WHEN uk.column_name IS NOT NULL THEN 'UNI'
                                ELSE '' 
                            END AS "Key",
                            '' AS "Extra"
                         FROM information_schema.columns c
                         LEFT JOIN (
                             SELECT ku.column_name
                             FROM information_schema.table_constraints tc
                             JOIN information_schema.key_column_usage ku
                                 ON tc.constraint_name = ku.constraint_name
                                 AND tc.table_schema = ku.table_schema
                                 AND tc.table_name = ku.table_name
                             WHERE tc.constraint_type = 'PRIMARY KEY'
                               AND tc.table_schema = 'public'
                               AND tc.table_name = $1
                         ) pk ON c.column_name = pk.column_name
                         LEFT JOIN (
                             SELECT ku.column_name
                             FROM information_schema.table_constraints tc
                             JOIN information_schema.key_column_usage ku
                                 ON tc.constraint_name = ku.constraint_name
                                 AND tc.table_schema = ku.table_schema
                                 AND tc.table_name = ku.table_name
                             WHERE tc.constraint_type = 'UNIQUE'
                               AND tc.table_schema = 'public'
                               AND tc.table_name = $1
                         ) uk ON c.column_name = uk.column_name
                         WHERE c.table_schema = 'public' AND c.table_name = $1
                         ORDER BY c.ordinal_position`,
                        [tableName]
                    );
                    return result.rows;
                } finally {
                    await client.end();
                }
            } else {
                const escapedDatabase = this.connection.escapeId(databaseName);
                const escapedTable = this.connection.escapeId(tableName);
                const [rows] = await this.connection.query(`DESCRIBE ${escapedDatabase}.${escapedTable}`);
                return rows;
            }
        } catch (error) {
            throw new Error(`Failed to get table structure: ${error.message}`);
        }
    }

    async getTableData(databaseName, tableName, limit = 100, offset = 0, sortColumn = null, sortDirection = 'ASC', searchFilters = null, searchLogic = 'AND') {
        if (!this.connection) throw new Error('No database connection');

        try {
            if (this.engine === 'postgresql') {
                const client = await this._pgGetClient(databaseName);
                try {
                    const tableRef = `${this._pgEscapeId('public')}.${this._pgEscapeId(tableName)}`;
                    const paramValues = [];
                    let paramIndex = 1;

                    // Build WHERE clause
                    let whereClause = '';
                    if (searchFilters && Array.isArray(searchFilters) && searchFilters.length > 0) {
                        const validFilters = searchFilters.filter(f => f.column && f.value);
                        if (validFilters.length > 0) {
                            const logic = searchLogic === 'OR' ? 'OR' : 'AND';
                            const conditions = validFilters.map(f => {
                                const col = this._pgEscapeId(f.column);
                                const operator = f.operator === 'NOT LIKE' ? 'NOT ILIKE' : 'ILIKE';
                                paramValues.push(`%${f.value}%`);
                                return `${col}::text ${operator} $${paramIndex++}`;
                            });
                            whereClause = ` WHERE ${conditions.join(` ${logic} `)}`;
                        }
                    }

                    // Build ORDER BY
                    let orderClause = '';
                    if (sortColumn) {
                        const direction = sortDirection.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
                        orderClause = ` ORDER BY ${this._pgEscapeId(sortColumn)} ${direction}`;
                    }

                    // Count
                    const countResult = await client.query(
                        `SELECT COUNT(*) AS total FROM ${tableRef}${whereClause}`,
                        paramValues
                    );
                    const total = parseInt(countResult.rows[0].total, 10);

                    // Data
                    const dataResult = await client.query(
                        `SELECT * FROM ${tableRef}${whereClause}${orderClause} LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`,
                        paramValues
                    );

                    return { data: dataResult.rows, total, limit, offset, sortColumn, sortDirection, searchFilters, searchLogic };
                } finally {
                    await client.end();
                }
            } else {
                // ── MySQL path (original code) ─────────────────────────────────
                const escapedDatabase = this.connection.escapeId(databaseName);
                const escapedTable = this.connection.escapeId(tableName);
                const fullTableName = `${escapedDatabase}.${escapedTable}`;

                let whereClause = '';
                if (searchFilters && Array.isArray(searchFilters) && searchFilters.length > 0) {
                    const validFilters = searchFilters.filter(f => f.column && f.value);
                    if (validFilters.length > 0) {
                        const logic = searchLogic === 'OR' ? 'OR' : 'AND';
                        const conditions = validFilters.map(f => {
                            const escapedCol = this.connection.escapeId(f.column);
                            const escapedVal = this.connection.escape(`%${f.value}%`);
                            const operator = f.operator === 'NOT LIKE' ? 'NOT LIKE' : 'LIKE';
                            return `${escapedCol} ${operator} ${escapedVal}`;
                        });
                        whereClause = ` WHERE ${conditions.join(` ${logic} `)}`;
                    }
                }

                let orderClause = '';
                if (sortColumn) {
                    const escapedSortColumn = this.connection.escapeId(sortColumn);
                    const direction = sortDirection.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
                    orderClause = ` ORDER BY ${escapedSortColumn} ${direction}`;
                }

                const countQuery = `SELECT COUNT(*) as total FROM ${fullTableName}${whereClause}`;
                const [countResult] = await this.connection.query(countQuery);
                const total = countResult[0].total;

                const dataQuery = `SELECT * FROM ${fullTableName}${whereClause}${orderClause} LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`;
                const [rows] = await this.connection.query(dataQuery);

                return { data: rows, total, limit, offset, sortColumn, sortDirection, searchFilters, searchLogic };
            }
        } catch (error) {
            throw new Error(`Failed to get table data: ${error.message}`);
        }
    }

    async executeQuery(databaseName, query) {
        if (!this.connection) throw new Error('No database connection');

        try {
            if (this.engine === 'postgresql') {
                const client = databaseName ? await this._pgGetClient(databaseName) : this.connection;
                const ownClient = databaseName && client !== this.connection;
                try {
                    const statements = query.trim().split(/;(?=(?:[^']*'[^']*')*[^']*$)/)
                        .map(s => s.trim()).filter(s => s.length > 0);

                    if (statements.length > 1) {
                        const results = [];
                        let totalAffected = 0;
                        for (const stmt of statements) {
                            const res = await client.query(stmt);
                            const upper = stmt.trim().toUpperCase();
                            if (upper.startsWith('SELECT') || upper.startsWith('WITH') || upper.startsWith('EXPLAIN')) {
                                results.push({ statement: stmt, data: res.rows, rowCount: res.rowCount });
                            } else {
                                totalAffected += res.rowCount || 0;
                            }
                        }
                        if (results.length > 0) {
                            return { type: 'SELECT', data: results, rowCount: results.reduce((t, r) => t + r.rowCount, 0), multipleStatements: true };
                        }
                        return { type: 'MODIFY', affectedRows: totalAffected, insertId: null, message: `${statements.length} statements executed successfully` };
                    }

                    const res = await client.query(query.trim());
                    const upper = query.trim().toUpperCase();
                    if (upper.startsWith('SELECT') || upper.startsWith('WITH') || upper.startsWith('EXPLAIN') || upper.startsWith('SHOW')) {
                        return { type: 'SELECT', data: res.rows, rowCount: res.rowCount };
                    }
                    return { type: 'MODIFY', affectedRows: res.rowCount || 0, insertId: null, message: 'Query executed successfully' };
                } finally {
                    if (ownClient) await client.end();
                }
            }

            // ── MySQL path ──────────────────────────────────────────────────────
            let finalQuery = query.trim();
            const upperQuery = query.toUpperCase().trim();

            if (upperQuery.startsWith('USE ')) {
                const dbMatch = query.match(/USE\s+`?(\w+)`?/i);
                if (dbMatch) {
                    try {
                        const testConnection = await mysql.createConnection({ ...this.credentials, database: dbMatch[1] });
                        await testConnection.end();
                        return { type: 'MODIFY', affectedRows: 0, insertId: null, message: `Database changed to '${dbMatch[1]}'` };
                    } catch (error) {
                        throw new Error(`Cannot use database '${dbMatch[1]}': ${error.message}`);
                    }
                }
            }

            const statements = finalQuery.split(';').map(stmt => stmt.trim()).filter(stmt => stmt.length > 0);

            if (statements.length > 1) {
                let totalAffectedRows = 0;
                let results = [];
                let lastInsertId = null;

                const execConnection = databaseName ?
                    await mysql.createConnection({ ...this.credentials, database: databaseName, multipleStatements: true }) :
                    this.connection;

                try {
                    for (const statement of statements) {
                        const [result] = await execConnection.query(statement);
                        if (statement.trim().toUpperCase().startsWith('SELECT') ||
                            statement.trim().toUpperCase().startsWith('SHOW') ||
                            statement.trim().toUpperCase().startsWith('DESCRIBE') ||
                            statement.trim().toUpperCase().startsWith('EXPLAIN')) {
                            results.push({ statement, data: result, rowCount: result.length });
                        } else {
                            totalAffectedRows += result.affectedRows || 0;
                            if (result.insertId) lastInsertId = result.insertId;
                        }
                    }
                    if (results.length > 0) {
                        return { type: 'SELECT', data: results, rowCount: results.reduce((total, r) => total + r.rowCount, 0), multipleStatements: true };
                    }
                    return { type: 'MODIFY', affectedRows: totalAffectedRows, insertId: lastInsertId, message: `${statements.length} statements executed successfully` };
                } finally {
                    if (execConnection !== this.connection) await execConnection.end();
                }
            }

            if (databaseName) {
                if (upperQuery.startsWith('SHOW TABLES')) {
                    const escapedDatabase = this.connection.escapeId(databaseName);
                    finalQuery = `SHOW TABLES FROM ${escapedDatabase}`;
                } else {
                    const dbConnection = await mysql.createConnection({ ...this.credentials, database: databaseName });
                    try {
                        const [result] = await dbConnection.query(finalQuery);
                        if (finalQuery.trim().toUpperCase().startsWith('SELECT') ||
                            finalQuery.trim().toUpperCase().startsWith('SHOW') ||
                            finalQuery.trim().toUpperCase().startsWith('DESCRIBE') ||
                            finalQuery.trim().toUpperCase().startsWith('EXPLAIN')) {
                            return { type: 'SELECT', data: result, rowCount: result.length };
                        }
                        return { type: 'MODIFY', affectedRows: result.affectedRows || 0, insertId: result.insertId || null, message: 'Query executed successfully' };
                    } finally {
                        await dbConnection.end();
                    }
                }
            }

            const [result] = await this.connection.query(finalQuery);
            if (finalQuery.trim().toUpperCase().startsWith('SELECT') ||
                finalQuery.trim().toUpperCase().startsWith('SHOW') ||
                finalQuery.trim().toUpperCase().startsWith('DESCRIBE') ||
                finalQuery.trim().toUpperCase().startsWith('EXPLAIN')) {
                return { type: 'SELECT', data: result, rowCount: result.length };
            }
            return { type: 'MODIFY', affectedRows: result.affectedRows || 0, insertId: result.insertId || null, message: 'Query executed successfully' };
        } catch (error) {
            throw new Error(`Query execution failed: ${error.message}`);
        }
    }

    async createDatabase(databaseName) {
        if (!this.connection) throw new Error('No database connection');
        try {
            if (this.engine === 'postgresql') {
                await this.connection.query(`CREATE DATABASE ${this._pgEscapeId(databaseName)}`);
            } else {
                await this.connection.query(`CREATE DATABASE ${this.connection.escapeId(databaseName)}`);
            }
        } catch (error) {
            throw new Error(`Failed to create database: ${error.message}`);
        }
    }

    async dropDatabase(databaseName) {
        if (!this.connection) throw new Error('No database connection');
        try {
            if (this.engine === 'postgresql') {
                await this.connection.query(`DROP DATABASE IF EXISTS ${this._pgEscapeId(databaseName)}`);
            } else {
                await this.connection.query(`DROP DATABASE ${this.connection.escapeId(databaseName)}`);
            }
        } catch (error) {
            throw new Error(`Failed to drop database: ${error.message}`);
        }
    }

    async createTable(databaseName, createTableQuery) {
        if (!this.connection) throw new Error('No database connection');
        try {
            if (this.engine === 'postgresql') {
                const client = await this._pgGetClient(databaseName);
                try { await client.query(createTableQuery); } finally { await client.end(); }
            } else {
                let finalQuery = createTableQuery;
                if (databaseName && !createTableQuery.includes(`${databaseName}.`)) {
                    finalQuery = createTableQuery.replace(/CREATE TABLE\s+`?(\w+)`?/i,
                        `CREATE TABLE \`${databaseName}\`.\`$1\``);
                }
                await this.connection.execute(finalQuery);
            }
        } catch (error) {
            throw new Error(`Failed to create table: ${error.message}`);
        }
    }

    async dropTable(databaseName, tableName) {
        if (!this.connection) throw new Error('No database connection');
        try {
            if (this.engine === 'postgresql') {
                const client = await this._pgGetClient(databaseName);
                try {
                    await client.query(`DROP TABLE IF EXISTS ${this._pgEscapeId('public')}.${this._pgEscapeId(tableName)}`);
                } finally { await client.end(); }
            } else {
                const escapedDatabase = this.connection.escapeId(databaseName);
                const escapedTable = this.connection.escapeId(tableName);
                await this.connection.query(`DROP TABLE ${escapedDatabase}.${escapedTable}`);
            }
        } catch (error) {
            throw new Error(`Failed to drop table: ${error.message}`);
        }
    }

    async alterTable(databaseName, tableName, alterQuery) {
        if (!this.connection) throw new Error('No database connection');
        try {
            if (this.engine === 'postgresql') {
                const client = await this._pgGetClient(databaseName);
                try { await client.query(alterQuery); } finally { await client.end(); }
            } else {
                const dbConnection = await mysql.createConnection({ ...this.credentials, database: databaseName });
                try { await dbConnection.query(alterQuery); } finally { await dbConnection.end(); }
            }
        } catch (error) {
            throw new Error(`Failed to alter table: ${error.message}`);
        }
    }

    async getTableIndexes(databaseName, tableName) {
        if (!this.connection) throw new Error('No database connection');
        try {
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
                         JOIN pg_class i ON i.oid = ix.indexrelid
                         JOIN pg_am am ON i.relam = am.oid
                         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
                         WHERE t.relname = $1 AND t.relkind = 'r'
                         ORDER BY i.relname, a.attnum`,
                        [tableName]
                    );
                    return result.rows;
                } finally { await client.end(); }
            } else {
                const escapedDatabase = this.connection.escapeId(databaseName);
                const escapedTable = this.connection.escapeId(tableName);
                const [rows] = await this.connection.query(`SHOW INDEX FROM ${escapedDatabase}.${escapedTable}`);
                return rows;
            }
        } catch (error) {
            throw new Error(`Failed to get table indexes: ${error.message}`);
        }
    }

    async getTableConstraints(databaseName, tableName) {
        if (!this.connection) throw new Error('No database connection');
        try {
            if (this.engine === 'postgresql') {
                const client = await this._pgGetClient(databaseName);
                try {
                    const result = await client.query(
                        `SELECT
                            tc.constraint_name AS "CONSTRAINT_NAME",
                            tc.constraint_type AS "CONSTRAINT_TYPE",
                            kcu.column_name AS "COLUMN_NAME",
                            ccu.table_name AS "REFERENCED_TABLE_NAME",
                            ccu.column_name AS "REFERENCED_COLUMN_NAME"
                         FROM information_schema.table_constraints tc
                         JOIN information_schema.key_column_usage kcu
                             ON tc.constraint_name = kcu.constraint_name
                             AND tc.table_schema = kcu.table_schema
                         LEFT JOIN information_schema.constraint_column_usage ccu
                             ON tc.constraint_name = ccu.constraint_name
                             AND tc.table_schema = ccu.table_schema
                         WHERE tc.table_schema = 'public' AND tc.table_name = $1
                         ORDER BY kcu.ordinal_position`,
                        [tableName]
                    );
                    return result.rows;
                } finally { await client.end(); }
            } else {
                const query = `
                    SELECT
                        CONSTRAINT_NAME,
                        CONSTRAINT_TYPE,
                        COLUMN_NAME,
                        REFERENCED_TABLE_NAME,
                        REFERENCED_COLUMN_NAME
                    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
                    JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                        ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
                        AND kcu.TABLE_SCHEMA = tc.TABLE_SCHEMA
                    WHERE kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ?
                    ORDER BY kcu.ORDINAL_POSITION
                `;
                const [rows] = await this.connection.query(query, [databaseName, tableName]);
                return rows;
            }
        } catch (error) {
            throw new Error(`Failed to get table constraints: ${error.message}`);
        }
    }

    _buildExportWhereClause({ whereClause = null, searchFilters = null, searchLogic = 'AND', selectedPKValues = null, pkColumn = null } = {}) {
        if (whereClause) return whereClause;

        if (selectedPKValues && pkColumn && selectedPKValues.length > 0) {
            if (this.engine === 'postgresql') {
                const escaped = selectedPKValues.map(v => this._pgEscapeLiteral(v)).join(', ');
                return `${this._pgEscapeId(pkColumn)} IN (${escaped})`;
            } else {
                const escaped = selectedPKValues.map(v => this.connection.escape(v)).join(', ');
                return `${this.connection.escapeId(pkColumn)} IN (${escaped})`;
            }
        }

        if (searchFilters && Array.isArray(searchFilters) && searchFilters.length > 0) {
            const validFilters = searchFilters.filter(f => f.column && f.value !== undefined && f.value !== '');
            if (validFilters.length > 0) {
                const logic = searchLogic === 'OR' ? 'OR' : 'AND';
                if (this.engine === 'postgresql') {
                    const conditions = validFilters.map(f => {
                        const col = this._pgEscapeId(f.column);
                        const op = f.operator === 'NOT LIKE' ? 'NOT ILIKE' : 'ILIKE';
                        const val = f.value.replace(/'/g, "''");
                        return `${col}::text ${op} '%${val}%'`;
                    });
                    return conditions.join(` ${logic} `);
                } else {
                    const conditions = validFilters.map(f => {
                        const col = this.connection.escapeId(f.column);
                        const val = this.connection.escape(`%${f.value}%`);
                        const op = f.operator === 'NOT LIKE' ? 'NOT LIKE' : 'LIKE';
                        return `${col} ${op} ${val}`;
                    });
                    return conditions.join(` ${logic} `);
                }
            }
        }

        return null;
    }

    async _exportTableAsJson(databaseName, tableName, options = {}) {
        const { includeData = true, selectedRows = null } = options;
        const whereClause = this._buildExportWhereClause(options);
        const result = { table: tableName, structure: [], data: [] };

        if (this.engine === 'postgresql') {
            const client = await this._pgGetClient(databaseName);
            try {
                const colsResult = await client.query(
                    `SELECT column_name, data_type, is_nullable, column_default
                     FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = $1
                     ORDER BY ordinal_position`,
                    [tableName]
                );
                result.structure = colsResult.rows;

                if (includeData) {
                    let dataQuery = `SELECT * FROM ${this._pgEscapeId('public')}.${this._pgEscapeId(tableName)}`;
                    if (whereClause) dataQuery += ` WHERE ${whereClause}`;
                    const dataResult = await client.query(dataQuery);
                    let rows = dataResult.rows;
                    if (selectedRows && Array.isArray(selectedRows)) {
                        rows = rows.filter((_, i) => selectedRows.includes(i));
                    }
                    result.data = rows;
                }
            } finally {
                await client.end();
            }
        } else {
            const [columns] = await this.connection.query(
                `SHOW COLUMNS FROM \`${databaseName}\`.\`${tableName}\``
            );
            result.structure = columns;

            if (includeData) {
                let dataQuery = `SELECT * FROM \`${databaseName}\`.\`${tableName}\``;
                if (whereClause) dataQuery += ` WHERE ${whereClause}`;
                const [rows] = await this.connection.query(dataQuery);
                let dataRows = rows;
                if (selectedRows && Array.isArray(selectedRows)) {
                    dataRows = rows.filter((_, i) => selectedRows.includes(i));
                }
                result.data = dataRows;
            }
        }

        return JSON.stringify(result, null, 2);
    }

    async exportDatabase(databaseName, options = {}) {
        if (!this.connection) throw new Error('No database connection');

        const { includeData = true, selectedTables = null, exportMethod = 'single', separateData = false, format = 'sql' } = options;

        try {
            const tables = selectedTables || await this.getTables(databaseName);
            const engineLabel = this.engine === 'postgresql' ? 'PostgreSQL' : 'MySQL';

            // JSON export path
            if (format === 'json') {
                const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
                if (exportMethod === 'single') {
                    const dbExport = {
                        database: databaseName,
                        exported: new Date().toISOString(),
                        engine: this.engine,
                        tables: {}
                    };
                    for (const tableName of tables) {
                        const tableJson = JSON.parse(await this._exportTableAsJson(databaseName, tableName, { includeData }));
                        dbExport.tables[tableName] = { structure: tableJson.structure, data: tableJson.data };
                    }
                    const jsonContent = JSON.stringify(dbExport, null, 2);
                    return {
                        filename: `${databaseName}_export_${timestamp}.json`,
                        content: jsonContent,
                        size: Buffer.byteLength(jsonContent, 'utf8'),
                        isZip: false
                    };
                } else {
                    // Split: one JSON file per table in a ZIP
                    return new Promise(async (resolve, reject) => {
                        const archive = archiver('zip', { zlib: { level: 9 } });
                        const chunks = [];
                        const output = new PassThrough();
                        output.on('data', (chunk) => chunks.push(chunk));
                        output.on('end', () => {
                            const resultBuffer = Buffer.concat(chunks);
                            resolve({
                                filename: `${databaseName}_export_${timestamp}.zip`,
                                content: resultBuffer,
                                size: resultBuffer.length,
                                isZip: true
                            });
                        });
                        archive.on('error', (err) => reject(err));
                        archive.pipe(output);
                        for (const tableName of tables) {
                            const tableJson = await this._exportTableAsJson(databaseName, tableName, { includeData });
                            archive.append(tableJson, { name: `${tableName}.json` });
                        }
                        await archive.finalize();
                    });
                }
            }

            if (exportMethod === 'single' && !separateData) {
                let sqlContent = `-- Database Export: ${databaseName}\n`;
                sqlContent += `-- Generated on: ${new Date().toISOString()}\n`;
                sqlContent += `-- ${engineLabel} Database Manager Export\n\n`;

                if (this.engine === 'postgresql') {
                    sqlContent += `-- Connect to the target database before running these statements\n\n`;
                } else {
                    sqlContent += `CREATE DATABASE IF NOT EXISTS \`${databaseName}\`;\n`;
                    sqlContent += `USE \`${databaseName}\`;\n\n`;
                }

                for (const tableName of tables) {
                    sqlContent += await this.exportTable(databaseName, tableName, { includeData });
                    sqlContent += '\n';
                }

                return {
                    filename: `${databaseName}_export_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.sql`,
                    content: sqlContent,
                    size: Buffer.byteLength(sqlContent, 'utf8'),
                    isZip: false
                };
            }

            return new Promise(async (resolve, reject) => {
                const archive = archiver('zip', { zlib: { level: 9 } });
                const chunks = [];
                const output = new PassThrough();

                output.on('data', (chunk) => chunks.push(chunk));
                output.on('end', () => {
                    const resultBuffer = Buffer.concat(chunks);
                    resolve({
                        filename: `${databaseName}_export_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.zip`,
                        content: resultBuffer,
                        size: resultBuffer.length,
                        isZip: true
                    });
                });

                archive.on('error', (err) => reject(err));
                archive.pipe(output);
                archive.append(`Database Export: ${databaseName}\nGenerated on: ${new Date().toISOString()}\n`, { name: 'info.txt' });

                if (exportMethod === 'single' && separateData) {
                    let structureContent = this.engine === 'postgresql'
                        ? `-- Connect to the target database before running\n\n`
                        : `CREATE DATABASE IF NOT EXISTS \`${databaseName}\`;\nUSE \`${databaseName}\`;\n\n`;
                    let dataContent = this.engine === 'postgresql'
                        ? `-- Data export\n\n`
                        : `USE \`${databaseName}\`;\n\n`;

                    for (const tableName of tables) {
                        structureContent += await this.exportTable(databaseName, tableName, { includeData: false }) + '\n';
                        if (includeData) {
                            dataContent += await this.exportTableDataOnly(databaseName, tableName) + '\n';
                        }
                    }

                    archive.append(structureContent, { name: 'structure.sql' });
                    if (includeData) archive.append(dataContent, { name: 'data.sql' });

                } else if (exportMethod === 'split') {
                    for (const tableName of tables) {
                        if (separateData) {
                            archive.append(await this.exportTable(databaseName, tableName, { includeData: false }), { name: `${tableName}_structure.sql` });
                            if (includeData) archive.append(await this.exportTableDataOnly(databaseName, tableName), { name: `${tableName}_data.sql` });
                        } else {
                            // One file per table (structure + data)
                            const tableContent = await this.exportTable(databaseName, tableName, { includeData });
                            archive.append(tableContent, { name: `${tableName}.sql` });
                        }
                    }
                }

                await archive.finalize();
            });

        } catch (error) {
            throw new Error(`Failed to export database: ${error.message}`);
        }
    }

    async exportTable(databaseName, tableName, options = {}) {
        if (!this.connection) throw new Error('No database connection');

        const { includeData = true, selectedRows = null, format = 'sql' } = options;
        const whereClause = this._buildExportWhereClause(options);

        if (format === 'json') {
            return this._exportTableAsJson(databaseName, tableName, { ...options, whereClause });
        }

        let sqlContent = '';

        if (this.engine === 'postgresql') {
            const client = await this._pgGetClient(databaseName);
            try {
                sqlContent += `-- Table structure for "${tableName}"\n`;
                sqlContent += `DROP TABLE IF EXISTS ${this._pgEscapeId(tableName)};\n`;

                // Build CREATE TABLE from information_schema
                const colsResult = await client.query(
                    `SELECT column_name, data_type, character_maximum_length, numeric_precision,
                            numeric_scale, is_nullable, column_default
                     FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = $1
                     ORDER BY ordinal_position`,
                    [tableName]
                );

                const pkResult = await client.query(
                    `SELECT ku.column_name FROM information_schema.table_constraints tc
                     JOIN information_schema.key_column_usage ku
                         ON tc.constraint_name = ku.constraint_name AND tc.table_schema = ku.table_schema
                     WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public' AND tc.table_name = $1`,
                    [tableName]
                );
                const pkColumns = new Set(pkResult.rows.map(r => r.column_name));

                const colDefs = colsResult.rows.map(c => {
                    let typeDef = c.data_type;
                    if (c.character_maximum_length) typeDef += `(${c.character_maximum_length})`;
                    else if (c.numeric_precision && c.numeric_scale) typeDef += `(${c.numeric_precision},${c.numeric_scale})`;
                    let colDef = `  ${this._pgEscapeId(c.column_name)} ${typeDef}`;
                    if (c.is_nullable === 'NO') colDef += ' NOT NULL';
                    if (c.column_default !== null) colDef += ` DEFAULT ${c.column_default}`;
                    return colDef;
                });

                if (pkColumns.size > 0) {
                    const pkCols = [...pkColumns].map(c => this._pgEscapeId(c)).join(', ');
                    colDefs.push(`  PRIMARY KEY (${pkCols})`);
                }

                sqlContent += `CREATE TABLE ${this._pgEscapeId(tableName)} (\n${colDefs.join(',\n')}\n);\n\n`;

                if (includeData) {
                    sqlContent += `-- Data for table "${tableName}"\n`;
                    let dataQuery = `SELECT * FROM ${this._pgEscapeId('public')}.${this._pgEscapeId(tableName)}`;
                    if (whereClause) dataQuery += ` WHERE ${whereClause}`;
                    const dataResult = await client.query(dataQuery);
                    let rows = dataResult.rows;
                    if (selectedRows && Array.isArray(selectedRows)) {
                        rows = rows.filter((_, i) => selectedRows.includes(i));
                    }
                    if (rows.length > 0) {
                        const cols = Object.keys(rows[0]);
                        const colsList = cols.map(c => this._pgEscapeId(c)).join(', ');
                        const valueStrings = rows.map(row => {
                            const vals = cols.map(col => this._pgEscapeLiteral(row[col]));
                            return `(${vals.join(', ')})`;
                        });
                        sqlContent += `INSERT INTO ${this._pgEscapeId(tableName)} (${colsList}) VALUES\n`;
                        sqlContent += valueStrings.join(',\n') + ';\n';
                    }
                }
            } finally {
                await client.end();
            }
            return sqlContent;
        }

        // ── MySQL path ──────────────────────────────────────────────────────────
        let oldSqlMode = null;

        try {
            try {
                const [modeResult] = await this.connection.query("SELECT @@SESSION.sql_mode as mode");
                if (modeResult && modeResult.length > 0) oldSqlMode = modeResult[0].mode;
                await this.connection.query("SET SESSION sql_mode = 'NO_AUTO_VALUE_ON_ZERO'");
            } catch (modeError) {
                console.warn('Warning: Failed to set safe SQL mode for export:', modeError.message);
            }

            sqlContent += `-- Table structure for \`${tableName}\`\n`;
            sqlContent += `DROP TABLE IF EXISTS \`${tableName}\`;\n`;

            const [createResult] = await this.connection.query(
                `SHOW CREATE TABLE \`${databaseName}\`.\`${tableName}\``
            );
            sqlContent += createResult[0]['Create Table'] + ';\n\n';

            if (includeData) {
                sqlContent += `-- Data for table \`${tableName}\`\n`;

                let dataQuery = `SELECT * FROM \`${databaseName}\`.\`${tableName}\``;

                // Add WHERE clause if provided
                if (whereClause) {
                    dataQuery += ` WHERE ${whereClause}`;
                }

                const [rows] = await this.connection.query(dataQuery);

                if (rows.length > 0) {
                    // Filter rows if specific rows are selected
                    let dataRows = rows;
                    if (selectedRows && Array.isArray(selectedRows)) {
                        dataRows = rows.filter((_, index) => selectedRows.includes(index));
                    }

                    if (dataRows.length > 0) {
                        const columns = Object.keys(dataRows[0]);
                        const columnsList = columns.map(col => `\`${col}\``).join(', ');

                        sqlContent += `LOCK TABLES \`${tableName}\` WRITE;\n`;
                        sqlContent += `INSERT INTO \`${tableName}\` (${columnsList}) VALUES\n`;

                        const valueStrings = dataRows.map(row => {
                            const values = columns.map(col => {
                                const value = row[col];
                                // DEBUG LOG
                                // if (tableName === 'projects' || tableName === 'content') {
                                //     console.log(`Export Debug: Table ${tableName}, Col ${col}, Type ${typeof value}, Value:`, value);
                                // }

                                if (value === null) return 'NULL';

                                // Fix for Arrays/JSON objects, but preserve Dates
                                if (typeof value === 'object' && !(value instanceof Date)) {
                                    console.log(`Stringifying object for column ${col}:`, value);
                                    return this.connection.escape(JSON.stringify(value));
                                }

                                return this.connection.escape(value);
                            });
                            return `(${values.join(', ')})`;
                        });

                        sqlContent += valueStrings.join(',\n') + ';\n';
                        sqlContent += `UNLOCK TABLES;\n`;
                    }
                }
            }

            return sqlContent;
        } catch (error) {
            throw new Error(`Failed to export table: ${error.message}`);
        } finally {
            // Restore original SQL mode
            if (oldSqlMode !== null) {
                try {
                    await this.connection.query(`SET SESSION sql_mode = ?`, [oldSqlMode]);
                } catch (restoreError) {
                    console.error('Error restoring SQL mode:', restoreError.message);
                }
            }
        }
    }

    async exportTableDataOnly(databaseName, tableName, options = {}) {
        if (!this.connection) throw new Error('No database connection');

        const { whereClause = null, selectedRows = null } = options;
        let sqlContent = '';

        if (this.engine === 'postgresql') {
            const client = await this._pgGetClient(databaseName);
            try {
                sqlContent += `-- Data for table "${tableName}"\n`;
                let dataQuery = `SELECT * FROM ${this._pgEscapeId('public')}.${this._pgEscapeId(tableName)}`;
                if (whereClause) dataQuery += ` WHERE ${whereClause}`;
                const dataResult = await client.query(dataQuery);
                let rows = dataResult.rows;
                if (selectedRows && Array.isArray(selectedRows)) {
                    rows = rows.filter((_, i) => selectedRows.includes(i));
                }
                if (rows.length > 0) {
                    const cols = Object.keys(rows[0]);
                    const colsList = cols.map(c => this._pgEscapeId(c)).join(', ');
                    const valueStrings = rows.map(row => {
                        const vals = cols.map(col => this._pgEscapeLiteral(row[col]));
                        return `(${vals.join(', ')})`;
                    });
                    sqlContent += `INSERT INTO ${this._pgEscapeId(tableName)} (${colsList}) VALUES\n`;
                    sqlContent += valueStrings.join(',\n') + ';\n';
                }
            } finally {
                await client.end();
            }
            return sqlContent;
        }

        try {
            sqlContent += `-- Data for table \`${tableName}\`\n`;

            let dataQuery = `SELECT * FROM \`${databaseName}\`.\`${tableName}\``;
            if (whereClause) dataQuery += ` WHERE ${whereClause}`;

            const [rows] = await this.connection.query(dataQuery);

            if (rows.length > 0) {
                let dataRows = rows;
                if (selectedRows && Array.isArray(selectedRows)) {
                    dataRows = rows.filter((_, index) => selectedRows.includes(index));
                }

                if (dataRows.length > 0) {
                    const columns = Object.keys(dataRows[0]);
                    const columnsList = columns.map(col => `\`${col}\``).join(', ');

                    sqlContent += `LOCK TABLES \`${tableName}\` WRITE;\n`;
                    sqlContent += `INSERT INTO \`${tableName}\` (${columnsList}) VALUES\n`;

                    const valueStrings = dataRows.map(row => {
                        const values = columns.map(col => {
                            const value = row[col];
                            if (value === null) return 'NULL';
                            if (typeof value === 'object' && !(value instanceof Date)) {
                                return this.connection.escape(JSON.stringify(value));
                            }
                            return this.connection.escape(value);
                        });
                        return `(${values.join(', ')})`;
                    });

                    sqlContent += valueStrings.join(',\n') + ';\n';
                    sqlContent += `UNLOCK TABLES;\n`;
                }
            }
            return sqlContent;
        } catch (error) {
            throw new Error(`Failed to export table data: ${error.message}`);
        }
    }

    async updateRow(databaseName, tableName, primaryKeyColumn, primaryKeyValue, updateData) {
        if (!this.connection) throw new Error('No database connection');
        try {
            const columns = Object.keys(updateData);
            if (columns.length === 0) return;

            if (this.engine === 'postgresql') {
                const client = await this._pgGetClient(databaseName);
                try {
                    const tableRef = `${this._pgEscapeId('public')}.${this._pgEscapeId(tableName)}`;
                    const values = columns.map(col => updateData[col]);
                    let paramIdx = 1;
                    const setClauses = columns.map(col => `${this._pgEscapeId(col)} = $${paramIdx++}`);
                    values.push(primaryKeyValue);
                    const query = `UPDATE ${tableRef} SET ${setClauses.join(', ')} WHERE ${this._pgEscapeId(primaryKeyColumn)} = $${paramIdx}`;
                    await client.query(query, values);
                } finally { await client.end(); }
            } else {
                const escapedDatabase = this.connection.escapeId(databaseName);
                const escapedTable = this.connection.escapeId(tableName);
                const setClauses = columns.map(col => `${this.connection.escapeId(col)} = ?`);
                const values = columns.map(col => updateData[col]);
                values.push(primaryKeyValue);
                const pkChanged = columns.includes(primaryKeyColumn) && updateData[primaryKeyColumn] != primaryKeyValue;
                const query = `UPDATE ${escapedDatabase}.${escapedTable} SET ${setClauses.join(', ')} WHERE ${this.connection.escapeId(primaryKeyColumn)} = ?`;
                if (pkChanged) {
                    await this.connection.query('SET FOREIGN_KEY_CHECKS=0');
                    try { await this.connection.execute(query, values); }
                    finally { await this.connection.query('SET FOREIGN_KEY_CHECKS=1'); }
                } else {
                    await this.connection.execute(query, values);
                }
            }
        } catch (error) {
            throw new Error(`Failed to update row: ${error.message}`);
        }
    }

    async deleteAllData(databaseName, tableName) {
        if (!this.connection) throw new Error('No database connection');
        try {
            if (this.engine === 'postgresql') {
                const client = await this._pgGetClient(databaseName);
                try {
                    const tableRef = `${this._pgEscapeId('public')}.${this._pgEscapeId(tableName)}`;
                    await client.query(`TRUNCATE TABLE ${tableRef}`);
                } finally { await client.end(); }
            } else {
                const escapedDatabase = this.connection.escapeId(databaseName);
                const escapedTable = this.connection.escapeId(tableName);
                try {
                    await this.connection.query(`TRUNCATE TABLE ${escapedDatabase}.${escapedTable}`);
                } catch {
                    await this.connection.query(`DELETE FROM ${escapedDatabase}.${escapedTable}`);
                }
            }
        } catch (error) {
            throw new Error(`Failed to delete all data: ${error.message}`);
        }
    }

    async deleteRows(databaseName, tableName, targetColumn, targetValues) {
        if (!this.connection) throw new Error('No database connection');
        if (!Array.isArray(targetValues) || targetValues.length === 0) throw new Error('No rows specified for deletion');
        try {
            if (this.engine === 'postgresql') {
                const client = await this._pgGetClient(databaseName);
                try {
                    const tableRef = `${this._pgEscapeId('public')}.${this._pgEscapeId(tableName)}`;
                    const col = this._pgEscapeId(targetColumn);
                    const placeholders = targetValues.map((_, i) => `$${i + 1}`).join(', ');
                    await client.query(`DELETE FROM ${tableRef} WHERE ${col} IN (${placeholders})`, targetValues);
                } finally { await client.end(); }
            } else {
                const escapedDatabase = this.connection.escapeId(databaseName);
                const escapedTable = this.connection.escapeId(tableName);
                const escapedColumn = this.connection.escapeId(targetColumn);
                const placeholders = targetValues.map(() => '?').join(',');
                await this.connection.query(`DELETE FROM ${escapedDatabase}.${escapedTable} WHERE ${escapedColumn} IN (${placeholders})`, targetValues);
            }
        } catch (error) {
            throw new Error(`Failed to delete rows: ${error.message}`);
        }
    }

    async getRowCount(databaseName, tableName, whereClause = null) {
        if (!this.connection) throw new Error('No database connection');
        try {
            if (this.engine === 'postgresql') {
                const client = await this._pgGetClient(databaseName);
                try {
                    const tableRef = `${this._pgEscapeId('public')}.${this._pgEscapeId(tableName)}`;
                    let query = `SELECT COUNT(*) AS count FROM ${tableRef}`;
                    if (whereClause) query += ` WHERE ${whereClause}`;
                    const result = await client.query(query);
                    return parseInt(result.rows[0].count, 10);
                } finally { await client.end(); }
            } else {
                let query = `SELECT COUNT(*) as count FROM \`${databaseName}\`.\`${tableName}\``;
                if (whereClause) query += ` WHERE ${whereClause}`;
                const [result] = await this.connection.query(query);
                return result[0].count;
            }
        } catch (error) {
            throw new Error(`Failed to get row count: ${error.message}`);
        }
    }

    async insertRow(databaseName, tableName, rowData) {
        if (!this.connection) throw new Error('No database connection');
        try {
            const columns = Object.keys(rowData);
            if (columns.length === 0) return;

            if (this.engine === 'postgresql') {
                const client = await this._pgGetClient(databaseName);
                try {
                    const tableRef = `${this._pgEscapeId('public')}.${this._pgEscapeId(tableName)}`;
                    const colsList = columns.map(c => this._pgEscapeId(c)).join(', ');
                    const values = columns.map(col => rowData[col]);
                    let paramIdx = 1;
                    const placeholders = columns.map(() => `$${paramIdx++}`).join(', ');
                    const query = `INSERT INTO ${tableRef} (${colsList}) VALUES (${placeholders})`;
                    await client.query(query, values);
                } finally { await client.end(); }
            } else {
                const escapedDatabase = this.connection.escapeId(databaseName);
                const escapedTable = this.connection.escapeId(tableName);
                const colsList = columns.map(c => this.connection.escapeId(c)).join(', ');
                const placeholders = columns.map(() => '?').join(', ');
                const values = columns.map(col => rowData[col]);
                const query = `INSERT INTO ${escapedDatabase}.${escapedTable} (${colsList}) VALUES (${placeholders})`;
                await this.connection.execute(query, values);
            }
        } catch (error) {
            throw new Error(`Failed to insert row: ${error.message}`);
        }
    }

    async importDatabase(databaseName, sqlContent) {
        if (!this.connection) throw new Error('No database connection');
        try {
            // Our executeQuery method handles basic splitting of multiple statements
            await this.executeQuery(databaseName, sqlContent);
        } catch (error) {
            throw new Error(`Failed to import database from SQL: ${error.message}`);
        }
    }

    async importDatabaseFromJson(databaseName, jsonContent) {
        if (!this.connection) throw new Error('No database connection');
        try {
            const data = typeof jsonContent === 'string' ? JSON.parse(jsonContent) : jsonContent;
            
            if (data && data.tables) {
                for (const [tableName, tableData] of Object.entries(data.tables)) {
                    if (tableData.data && tableData.data.length > 0) {
                        for (const row of tableData.data) {
                            try {
                                await this.insertRow(databaseName, tableName, row);
                            } catch (err) {
                                console.error(`Error inserting row into ${tableName}:`, err.message);
                            }
                        }
                    }
                }
            }
        } catch (error) {
            throw new Error(`Failed to import database from JSON: ${error.message}`);
        }
    }

    async getDatabaseSizes() {
        if (!this.connection) throw new Error('No database connection');
        try {
            if (this.engine === 'postgresql') {
                const result = await this.connection.query(
                    `SELECT datname as database, pg_database_size(datname) as size_bytes
                     FROM pg_database WHERE datistemplate = false`
                );
                return result.rows.map(row => ({
                    database: row.database,
                    sizeMb: (parseInt(row.size_bytes) / 1024 / 1024).toFixed(2)
                }));
            } else {
                const [rows] = await this.connection.query(
                    `SELECT table_schema AS 'database', 
                            SUM(data_length + index_length) AS 'size_bytes' 
                     FROM information_schema.tables 
                     GROUP BY table_schema`
                );
                return rows.map(row => ({
                    database: row.database,
                    sizeMb: (row.size_bytes / 1024 / 1024).toFixed(2)
                }));
            }
        } catch (error) {
            console.error(`Failed to get database sizes: ${error.message}`);
            return []; // non-fatal
        }
    }

    async getTableSizes(databaseName) {
        if (!this.connection) throw new Error('No database connection');
        try {
            if (this.engine === 'postgresql') {
                const client = await this._pgGetClient(databaseName);
                try {
                    const result = await client.query(
                        `SELECT relname as table_name, pg_total_relation_size(C.oid) as size_bytes
                         FROM pg_class C LEFT JOIN pg_namespace N ON (N.oid = C.relnamespace)
                         WHERE nspname NOT IN ('pg_catalog', 'information_schema') AND C.relkind <> 'i' AND nspname !~ '^pg_toast'`
                    );
                    return result.rows.map(row => ({
                        table: row.table_name,
                        sizeMb: (parseInt(row.size_bytes) / 1024 / 1024).toFixed(2)
                    }));
                } finally {
                    await client.end();
                }
            } else {
                const escapedDatabase = this.connection.escape(databaseName);
                const [rows] = await this.connection.query(
                    `SELECT table_name, (data_length + index_length) AS size_bytes 
                     FROM information_schema.tables 
                     WHERE table_schema = ${escapedDatabase}`
                );
                return rows.map(row => ({
                    table: row.table_name,
                    sizeMb: (row.size_bytes / 1024 / 1024).toFixed(2)
                }));
            }
        } catch (error) {
            console.error(`Failed to get table sizes: ${error.message}`);
            return []; // non-fatal
        }
    }
}

module.exports = DatabaseManager;
