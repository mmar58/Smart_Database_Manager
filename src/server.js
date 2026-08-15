require('dotenv').config();
const express = require('express');
const session = require('express-session');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const DatabaseManager = require('./database/DatabaseManager');
const jwt = require('jsonwebtoken');
const fs = require('fs/promises');
const fsSync = require('fs');
const os = require('os');
const cron = require('node-cron');
const multer = require('multer');

const app = express();

// Create session middleware
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'db-manager-session-secret',
    resave: false,
    saveUninitialized: true
});

app.use(sessionMiddleware);
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    maxHttpBufferSize: 50e6 // 50MB for large imports
});

io.use((socket, next) => { sessionMiddleware(socket.request, {}, next); });

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/backups', express.static(path.join(__dirname, '..', 'backups')));

// Store active database connections
const activeConnections = new Map();

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- File paths ---
const DATA_DIR = path.join(__dirname, '..', 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const QUERY_HISTORY_FILE = path.join(DATA_DIR, 'query_history.json');
const ANNOTATIONS_FILE = path.join(DATA_DIR, 'annotations.json');
const CREDS_FILE = path.join(DATA_DIR, 'credentials.enc');
const SERVER_CONNECTIONS_FILE = path.join(DATA_DIR, 'server_connections.enc');
const SALT_FILE = path.join(DATA_DIR, '.salt');
const BACKUPS_DIR = path.join(__dirname, '..', 'backups');

// Ensure directories exist
[DATA_DIR, BACKUPS_DIR].forEach(dir => {
    if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
});

// ============================================================
//  AES-256-GCM CREDENTIAL ENCRYPTION SERVICE
// ============================================================
function getMachineKey() {
    let salt;
    if (fsSync.existsSync(SALT_FILE)) {
        salt = fsSync.readFileSync(SALT_FILE, 'utf8').trim();
    } else {
        salt = crypto.randomBytes(32).toString('hex');
        fsSync.writeFileSync(SALT_FILE, salt, 'utf8');
    }
    const seed = os.hostname() + 'db-manager-v2-' + (process.env.CRYPT_PEPPER || 'default-pepper');
    return crypto.scryptSync(seed, salt, 32);
}

function encryptSecret(plaintext) {
    const key = getMachineKey();
    const iv = crypto.randomBytes(12); // 96-bit IV for GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Format: iv(hex):tag(hex):ciphertext(hex)
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptSecret(data) {
    const parts = data.split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted data format');
    const key = getMachineKey();
    const iv = Buffer.from(parts[0], 'hex');
    const tag = Buffer.from(parts[1], 'hex');
    const encrypted = Buffer.from(parts[2], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted) + decipher.final('utf8');
}

async function loadCreds() {
    if (!fsSync.existsSync(CREDS_FILE)) return {};
    try { return JSON.parse(await fs.readFile(CREDS_FILE, 'utf8')); } catch { return {}; }
}

async function setSecureCredential(key, password) {
    const creds = await loadCreds();
    creds[key] = encryptSecret(password);
    await fs.writeFile(CREDS_FILE, JSON.stringify(creds));
}

async function getSecureCredential(key) {
    const creds = await loadCreds();
    if (!creds[key]) return null;
    try { return decryptSecret(creds[key]); } catch { return null; }
}

async function deleteSecureCredential(key) {
    const creds = await loadCreds();
    delete creds[key];
    await fs.writeFile(CREDS_FILE, JSON.stringify(creds));
}

// Helper function to get client IP
function getClientIp(req) {
    return req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
}

app.get('/api/my-ip', (req, res) => {
    res.json({ ip: getClientIp(req) });
});

async function loadServerConnections() {
    if (!fsSync.existsSync(SERVER_CONNECTIONS_FILE)) return {};
    try {
        const encrypted = await fs.readFile(SERVER_CONNECTIONS_FILE, 'utf8');
        if (!encrypted) return {};
        const decrypted = decryptSecret(encrypted);
        return JSON.parse(decrypted);
    } catch {
        return {};
    }
}

async function saveServerConnections(connections) {
    const encrypted = encryptSecret(JSON.stringify(connections));
    await fs.writeFile(SERVER_CONNECTIONS_FILE, encrypted);
}

app.post('/api/connections/save', async (req, res) => {
    try {
        const { id, connection } = req.body;
        if (!id || !connection) return res.status(400).json({ error: 'Missing id or connection' });
        const connections = await loadServerConnections();
        connections[id] = connection;
        await saveServerConnections(connections);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/connections/list', async (req, res) => {
    try {
        const clientIp = getClientIp(req);
        const connections = await loadServerConnections();
        const authorizedConnections = {};
        for (const [id, conn] of Object.entries(connections)) {
            const restriction = conn.ipRestriction;
            if (restriction === 'all') {
                authorizedConnections[id] = conn;
            } else if (restriction === 'current' && conn.savedIp === clientIp) {
                authorizedConnections[id] = conn;
            } else if (restriction === 'selected' && (conn.selectedIps || []).includes(clientIp)) {
                authorizedConnections[id] = conn;
            }
        }
        res.json({ connections: authorizedConnections });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/connections/delete', async (req, res) => {
    try {
        const { id } = req.query;
        if (!id) return res.status(400).json({ error: 'Missing id' });
        const connections = await loadServerConnections();
        if (connections[id]) {
            delete connections[id];
            await saveServerConnections(connections);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/connections/edit', async (req, res) => {
    try {
        const { id, connection } = req.body;
        if (!id || !connection) return res.status(400).json({ error: 'Missing id or connection' });
        const connections = await loadServerConnections();
        if (connections[id]) {
            connections[id] = { ...connections[id], ...connection };
            await saveServerConnections(connections);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Credential REST endpoints
app.post('/api/credential/set', async (req, res) => {
    const { key, password } = req.body;
    if (!key || !password) return res.status(400).json({ error: 'Missing key or password' });
    try {
        await setSecureCredential(key, password);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/credential/get', async (req, res) => {
    const { key } = req.query;
    if (!key) return res.status(400).json({ error: 'Missing key' });
    try {
        const password = await getSecureCredential(key);
        res.json({ password });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/credential/delete', async (req, res) => {
    const { key } = req.query;
    if (!key) return res.status(400).json({ error: 'Missing key' });
    try {
        await deleteSecureCredential(key);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Multer for backup uploads
const upload = multer({ dest: BACKUPS_DIR });

// System Stats API
let _prevCpuTimes = null;
app.get('/api/system-stats', (req, res) => {
    const cpus = os.cpus();
    let idle = 0, total = 0;
    cpus.forEach(cpu => {
        for (const t in cpu.times) total += cpu.times[t];
        idle += cpu.times.idle;
    });
    idle /= cpus.length;
    total /= cpus.length;

    let cpuUsage = 0;
    if (_prevCpuTimes) {
        const idleDiff = idle - _prevCpuTimes.idle;
        const totalDiff = total - _prevCpuTimes.total;
        cpuUsage = totalDiff > 0 ? Math.round(100 * (1 - idleDiff / totalDiff)) : 0;
    }
    _prevCpuTimes = { idle, total };

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    res.json({
        cpuUsage: Math.max(0, Math.min(100, cpuUsage)),
        memUsage: ((usedMem / totalMem) * 100).toFixed(1),
        totalMem: (totalMem / 1024 / 1024 / 1024).toFixed(2) + ' GB',
        usedMem: (usedMem / 1024 / 1024 / 1024).toFixed(2) + ' GB',
        cpuModel: cpus[0]?.model || 'Unknown',
        cpuCount: cpus.length,
        platform: os.platform(),
        uptime: Math.floor(os.uptime())
    });
});

// Upload Backup Endpoint
app.post('/api/upload-backup', upload.single('backupFile'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const originalName = req.file.originalname;
    const newPath = path.join(BACKUPS_DIR, originalName);
    try {
        await fs.rename(req.file.path, newPath);
        res.json({ success: true, message: 'Backup uploaded successfully', filename: originalName });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save uploaded file' });
    }
});

// JWT
const JWT_SECRET = process.env.JWT_SECRET_KEY || 'your_fallback_secret_key_change_in_production';

app.get('/session-credentials', (req, res) => {
    const token = (req.headers.authorization || '').split(' ')[1];
    if (!token) return res.json({});
    try {
        const d = jwt.verify(token, JWT_SECRET);
        res.json({ host: d.host, port: d.port, username: d.username, database: d.database, ssl: d.ssl, engine: d.engine });
    } catch { res.json({}); }
});

app.post('/store-credentials', (req, res) => {
    const { host, port, username, database, ssl, engine } = req.body;
    // Note: password is NOT stored in JWT – it's in encrypted credentials store
    const token = jwt.sign({ host, port, username, database, ssl, engine }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token });
});

// ============================================================
//  SOCKET.IO HANDLERS
// ============================================================
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('connect_database', async (credentials) => {
        console.log(`[connect_database] socket=${socket.id} host=${credentials.host} engine=${credentials.engine}`);
        try {
            const dbManager = new DatabaseManager(credentials);
            await dbManager.connect();
            activeConnections.set(socket.id, dbManager);
            console.log(`[connect_database] SUCCESS socket=${socket.id}`);
            socket.emit('connection_success', { message: 'Connected to database', connectionId: socket.id });
        } catch (error) {
            console.error(`[connect_database] FAILED socket=${socket.id}:`, error.message);
            socket.emit('connection_error', { message: 'Failed to connect', error: error.message });
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
        try { socket.emit('databases_list', await db.getDatabases()); }
        catch (e) { socket.emit('error', { message: e.message }); }
    });

    socket.on('get_tables', async (databaseName) => {
        const db = activeConnections.get(socket.id);
        if (!db) return socket.emit('error', { message: 'No active connection' });
        try { socket.emit('tables_list', { database: databaseName, tables: await db.getTables(databaseName) }); }
        catch (e) { socket.emit('error', { message: e.message }); }
    });

    socket.on('get_table_structure', async ({ database, table }) => {
        const db = activeConnections.get(socket.id);
        if (!db) return socket.emit('error', { message: 'No active connection' });
        try { socket.emit('table_structure', { database, table, structure: await db.getTableStructure(database, table) }); }
        catch (e) { socket.emit('error', { message: e.message }); }
    });

    socket.on('get_table_data', async ({ database, table, limit = 100, offset = 0, sortColumn = null, sortDirection = 'ASC', searchFilters = null, searchLogic = 'AND' }) => {
        const db = activeConnections.get(socket.id);
        if (!db) return socket.emit('error', { message: 'No active connection' });
        try {
            const result = await db.getTableData(database, table, limit, offset, sortColumn, sortDirection, searchFilters, searchLogic);
            socket.emit('table_data', { database, table, ...result });
        } catch (e) { socket.emit('error', { message: e.message }); }
    });

    socket.on('execute_query', async ({ database, query }) => {
        const db = activeConnections.get(socket.id);
        if (!db) return socket.emit('error', { message: 'No active connection' });
        try { socket.emit('query_result', { query, result: await db.executeQuery(database, query) }); }
        catch (e) {
            socket.emit('query_execution_error', { message: e.message, query, database });
            socket.emit('error', { message: e.message });
        }
    });

    socket.on('create_database', async (databaseName) => {
        const db = activeConnections.get(socket.id);
        if (!db) return socket.emit('error', { message: 'No active connection' });
        try { await db.createDatabase(databaseName); socket.emit('database_created', { message: `Database '${databaseName}' created` }); }
        catch (e) { socket.emit('error', { message: e.message }); }
    });

    socket.on('drop_database', async (databaseName) => {
        const db = activeConnections.get(socket.id);
        if (!db) return socket.emit('error', { message: 'No active connection' });
        try { await db.dropDatabase(databaseName); socket.emit('database_dropped', { message: `Database '${databaseName}' dropped` }); }
        catch (e) { socket.emit('error', { message: e.message }); }
    });

    socket.on('alter_table', async ({ database, table, alterQuery }) => {
        const db = activeConnections.get(socket.id);
        if (!db) return socket.emit('error', { message: 'No active connection' });
        try { await db.alterTable(database, table, alterQuery); socket.emit('table_altered', { message: `Table '${table}' altered` }); }
        catch (e) { socket.emit('error', { message: e.message }); }
    });

    socket.on('get_table_indexes', async ({ database, table }) => {
        const db = activeConnections.get(socket.id);
        if (!db) return socket.emit('error', { message: 'No active connection' });
        try { socket.emit('table_indexes', { database, table, indexes: await db.getTableIndexes(database, table) }); }
        catch (e) { socket.emit('error', { message: e.message }); }
    });

    socket.on('get_table_constraints', async ({ database, table }) => {
        const db = activeConnections.get(socket.id);
        if (!db) return socket.emit('error', { message: 'No active connection' });
        try { socket.emit('table_constraints', { database, table, constraints: await db.getTableConstraints(database, table) }); }
        catch (e) { socket.emit('error', { message: e.message }); }
    });

    socket.on('drop_table', async ({ database, table }) => {
        const db = activeConnections.get(socket.id);
        if (!db) return socket.emit('error', { message: 'No active connection' });
        try { await db.dropTable(database, table); socket.emit('table_dropped', { message: `Table '${table}' dropped` }); }
        catch (e) { socket.emit('error', { message: e.message }); }
    });

    socket.on('export_database', async ({ database, options = {} }) => {
        const db = activeConnections.get(socket.id);
        if (!db) return socket.emit('error', { message: 'No active connection' });
        try { socket.emit('database_exported', await db.exportDatabase(database, options)); }
        catch (e) { socket.emit('error', { message: e.message }); }
    });

    socket.on('export_table', async ({ database, table, options = {} }) => {
        const db = activeConnections.get(socket.id);
        if (!db) return socket.emit('error', { message: 'No active connection' });
        try {
            const content = await db.exportTable(database, table, options);
            const ext = options.format === 'json' ? 'json' : 'sql';
            socket.emit('table_exported', {
                filename: `${table}_export_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.${ext}`,
                content,
                size: Buffer.byteLength(content, 'utf8')
            });
        } catch (e) { socket.emit('error', { message: e.message }); }
    });

    socket.on('get_row_count', async ({ database, table, whereClause = null }) => {
        const db = activeConnections.get(socket.id);
        if (!db) return socket.emit('error', { message: 'No active connection' });
        try { socket.emit('row_count_result', { database, table, count: await db.getRowCount(database, table, whereClause), whereClause }); }
        catch (e) { socket.emit('error', { message: e.message }); }
    });

    socket.on('delete_all_data', async ({ database, table }) => {
        const db = activeConnections.get(socket.id);
        if (!db) return socket.emit('error', { message: 'No active connection' });
        try { await db.deleteAllData(database, table); socket.emit('data_deleted', { message: `All data deleted from '${table}'` }); }
        catch (e) { socket.emit('error', { message: e.message }); }
    });

    socket.on('update_row', async ({ database, table, primaryKeyColumn, primaryKeyValue, updateData }) => {
        const db = activeConnections.get(socket.id);
        if (!db) return socket.emit('error', { message: 'No active connection' });
        try { await db.updateRow(database, table, primaryKeyColumn, primaryKeyValue, updateData); socket.emit('row_updated', { message: 'Row updated' }); }
        catch (e) { socket.emit('error', { message: e.message }); }
    });

    socket.on('delete_selected_data', async ({ database, table, targetColumn, targetValues }) => {
        const db = activeConnections.get(socket.id);
        if (!db) return socket.emit('error', { message: 'No active connection' });
        try { await db.deleteRows(database, table, targetColumn, targetValues); socket.emit('data_deleted', { message: `${targetValues.length} rows deleted` }); }
        catch (e) { socket.emit('error', { message: e.message }); }
    });

    socket.on('import_database', async ({ database, content, type }) => {
        const db = activeConnections.get(socket.id);
        if (!db) return socket.emit('error', { message: 'No active connection' });
        try {
            if (type === 'json') await db.importDatabaseFromJson(database, content);
            else await db.importDatabase(database, content);
            socket.emit('database_imported', { message: 'Import completed successfully' });
        } catch (e) { socket.emit('error', { message: e.message }); }
    });

    socket.on('insert_row', async ({ database, table, rowData }) => {
        const db = activeConnections.get(socket.id);
        if (!db) return socket.emit('error', { message: 'No active connection' });
        try { await db.insertRow(database, table, rowData); socket.emit('row_inserted', { message: 'Row inserted successfully' }); }
        catch (e) { socket.emit('error', { message: e.message }); }
    });

    socket.on('get_db_sizes', async () => {
        const db = activeConnections.get(socket.id);
        if (!db) return;
        try { socket.emit('db_sizes', await db.getDatabaseSizes()); } catch {}
    });

    socket.on('get_table_sizes', async (database) => {
        const db = activeConnections.get(socket.id);
        if (!db) return;
        try { socket.emit('table_sizes', { database, sizes: await db.getTableSizes(database) }); } catch {}
    });

    // ---- ER Diagram / FK data ----
    socket.on('get_foreign_keys', async (database) => {
        const db = activeConnections.get(socket.id);
        if (!db) return socket.emit('error', { message: 'No active connection' });
        try {
            let fkData = [];
            if (db.engine === 'postgresql') {
                const client = await db._pgGetClient(database);
                try {
                    const result = await client.query(`
                        SELECT
                            tc.table_name AS from_table,
                            kcu.column_name AS from_column,
                            ccu.table_name AS to_table,
                            ccu.column_name AS to_column,
                            tc.constraint_name
                        FROM information_schema.table_constraints tc
                        JOIN information_schema.key_column_usage kcu
                            ON tc.constraint_name = kcu.constraint_name
                        JOIN information_schema.constraint_column_usage ccu
                            ON tc.constraint_name = ccu.constraint_name
                        WHERE tc.constraint_type = 'FOREIGN KEY'
                    `);
                    fkData = result.rows;
                } finally { await client.end(); }
            } else {
                const [rows] = await db.connection.query(`
                    SELECT
                        TABLE_NAME AS from_table,
                        COLUMN_NAME AS from_column,
                        REFERENCED_TABLE_NAME AS to_table,
                        REFERENCED_COLUMN_NAME AS to_column,
                        CONSTRAINT_NAME AS constraint_name
                    FROM information_schema.KEY_COLUMN_USAGE
                    WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL
                `, [database]);
                fkData = rows;
            }
            socket.emit('foreign_keys', { database, fkData });
        } catch (e) { socket.emit('error', { message: e.message }); }
    });

    // ---- Schema Diff ----
    socket.on('diff_databases', async ({ database1, database2 }) => {
        const db = activeConnections.get(socket.id);
        if (!db) return socket.emit('error', { message: 'No active connection' });
        try {
            const [tables1, tables2] = await Promise.all([db.getTables(database1), db.getTables(database2)]);
            const set1 = new Set(tables1);
            const set2 = new Set(tables2);
            const added = tables2.filter(t => !set1.has(t));
            const removed = tables1.filter(t => !set2.has(t));
            const common = tables1.filter(t => set2.has(t));
            const modified = [];
            for (const table of common) {
                const [s1, s2] = await Promise.all([db.getTableStructure(database1, table), db.getTableStructure(database2, table)]);
                const fields1 = new Map(s1.map(f => [f.Field, f]));
                const fields2 = new Map(s2.map(f => [f.Field, f]));
                const changes = [];
                for (const [name, f] of fields1) {
                    if (!fields2.has(name)) changes.push({ type: 'removed_column', column: name });
                    else {
                        const f2 = fields2.get(name);
                        if (f.Type !== f2.Type || f.Null !== f2.Null || f.Default !== f2.Default)
                            changes.push({ type: 'modified_column', column: name, from: f, to: f2 });
                    }
                }
                for (const [name] of fields2) {
                    if (!fields1.has(name)) changes.push({ type: 'added_column', column: name });
                }
                if (changes.length > 0) modified.push({ table, changes });
            }
            socket.emit('schema_diff', { database1, database2, added, removed, modified });
        } catch (e) { socket.emit('error', { message: e.message }); }
    });

    // ---- Slow Query Monitor ----
    socket.on('get_slow_queries', async ({ database, limit = 20 }) => {
        const db = activeConnections.get(socket.id);
        if (!db) return socket.emit('error', { message: 'No active connection' });
        try {
            let queries = [];
            if (db.engine === 'postgresql') {
                // Requires pg_stat_statements extension
                try {
                    const client = await db._pgGetClient(database);
                    try {
                        const result = await client.query(`
                            SELECT query, calls, total_exec_time, mean_exec_time, rows
                            FROM pg_stat_statements
                            ORDER BY mean_exec_time DESC
                            LIMIT $1
                        `, [limit]);
                        queries = result.rows.map(r => ({
                            query: r.query,
                            execCount: r.calls,
                            totalMs: parseFloat(r.total_exec_time).toFixed(2),
                            avgMs: parseFloat(r.mean_exec_time).toFixed(2),
                            rows: r.rows
                        }));
                    } finally { await client.end(); }
                } catch (pgErr) {
                    socket.emit('slow_queries', { queries: [], warning: 'pg_stat_statements extension not enabled. Run: CREATE EXTENSION pg_stat_statements;' });
                    return;
                }
            } else {
                // MySQL performance_schema
                try {
                    const [rows] = await db.connection.query(`
                        SELECT DIGEST_TEXT AS query, COUNT_STAR AS exec_count,
                               SUM_TIMER_WAIT/1000000000 AS total_ms,
                               AVG_TIMER_WAIT/1000000000 AS avg_ms,
                               SUM_ROWS_EXAMINED AS rows_examined
                        FROM performance_schema.events_statements_summary_by_digest
                        WHERE SCHEMA_NAME = ?
                        ORDER BY avg_ms DESC
                        LIMIT ?
                    `, [database, limit]);
                    queries = rows.map(r => ({
                        query: r.query,
                        execCount: r.exec_count,
                        totalMs: parseFloat(r.total_ms).toFixed(2),
                        avgMs: parseFloat(r.avg_ms).toFixed(2),
                        rows: r.rows_examined
                    }));
                } catch (perfErr) {
                    socket.emit('slow_queries', { queries: [], warning: 'performance_schema not available. Enable it in MySQL config with performance_schema=ON' });
                    return;
                }
            }
            socket.emit('slow_queries', { queries });
        } catch (e) { socket.emit('error', { message: e.message }); }
    });

    // ---- Annotations ----
    socket.on('get_annotations', async () => {
        try {
            if (fsSync.existsSync(ANNOTATIONS_FILE)) {
                socket.emit('annotations', JSON.parse(await fs.readFile(ANNOTATIONS_FILE, 'utf8')));
            } else {
                socket.emit('annotations', {});
            }
        } catch {}
    });

    socket.on('save_annotation', async ({ key, note }) => {
        try {
            let data = {};
            if (fsSync.existsSync(ANNOTATIONS_FILE)) data = JSON.parse(await fs.readFile(ANNOTATIONS_FILE, 'utf8'));
            data[key] = { note, updatedAt: new Date().toISOString() };
            await fs.writeFile(ANNOTATIONS_FILE, JSON.stringify(data, null, 2));
            socket.emit('annotations', data);
        } catch (e) { socket.emit('error', { message: 'Failed to save annotation' }); }
    });

    socket.on('delete_annotation', async ({ key }) => {
        try {
            let data = {};
            if (fsSync.existsSync(ANNOTATIONS_FILE)) data = JSON.parse(await fs.readFile(ANNOTATIONS_FILE, 'utf8'));
            delete data[key];
            await fs.writeFile(ANNOTATIONS_FILE, JSON.stringify(data, null, 2));
            socket.emit('annotations', data);
        } catch {}
    });

    // ---- Settings ----
    socket.on('get_settings', async () => {
        try {
            let settings = {};
            if (fsSync.existsSync(SETTINGS_FILE)) settings = JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf8'));
            socket.emit('settings', settings);
        } catch {}
    });

    socket.on('save_settings', async (settings) => {
        try {
            await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
            socket.emit('settings_saved', { message: 'Settings saved' });
            setupAutoBackup();
        } catch { socket.emit('error', { message: 'Failed to save settings' }); }
    });

    // ---- Backup Management ----
    socket.on('list_backups', async () => {
        try {
            if (!fsSync.existsSync(BACKUPS_DIR)) { socket.emit('backups_list', []); return; }
            const files = await fs.readdir(BACKUPS_DIR);
            const backups = [];
            for (const file of files) {
                const stat = await fs.stat(path.join(BACKUPS_DIR, file));
                if (stat.isFile()) {
                    // Parse metadata from filename: dbname_profilename_autobackup_timestamp.sql
                    const parts = file.split('_autobackup_');
                    const meta = parts.length > 1 ? parts[0] : null;
                    backups.push({ name: file, size: stat.size, date: stat.mtime, meta });
                }
            }
            backups.sort((a, b) => b.date - a.date);
            socket.emit('backups_list', backups);
        } catch { socket.emit('error', { message: 'Failed to list backups' }); }
    });

    socket.on('delete_backup', async (filename) => {
        try {
            await fs.unlink(path.join(BACKUPS_DIR, filename));
            socket.emit('backup_deleted', { message: `Deleted ${filename}` });
        } catch { socket.emit('error', { message: 'Failed to delete backup' }); }
    });

    socket.on('restore_backup', async ({ filename, targetDatabase }) => {
        const db = activeConnections.get(socket.id);
        if (!db) return socket.emit('error', { message: 'No active connection' });
        try {
            const content = await fs.readFile(path.join(BACKUPS_DIR, filename), 'utf8');
            if (filename.endsWith('.json')) await db.importDatabaseFromJson(targetDatabase, content);
            else await db.importDatabase(targetDatabase, content);
            socket.emit('backup_restored', { message: `Restored ${filename} to ${targetDatabase}` });
        } catch (e) { socket.emit('error', { message: `Restore failed: ${e.message}` }); }
    });

    // ---- Query History ----
    socket.on('get_query_history', async () => {
        try {
            if (fsSync.existsSync(QUERY_HISTORY_FILE)) socket.emit('query_history', JSON.parse(await fs.readFile(QUERY_HISTORY_FILE, 'utf8')));
            else socket.emit('query_history', []);
        } catch {}
    });

    socket.on('save_query_history', async (queryObj) => {
        try {
            let history = fsSync.existsSync(QUERY_HISTORY_FILE) ? JSON.parse(await fs.readFile(QUERY_HISTORY_FILE, 'utf8')) : [];
            history.unshift({ ...queryObj, timestamp: new Date().toISOString() });
            if (history.length > 200) history = history.slice(0, 200);
            await fs.writeFile(QUERY_HISTORY_FILE, JSON.stringify(history, null, 2));
            socket.emit('query_history', history);
        } catch {}
    });

    socket.on('clear_query_history', async () => {
        try { await fs.writeFile(QUERY_HISTORY_FILE, '[]'); socket.emit('query_history', []); } catch {}
    });

    socket.on('disconnect', async () => {
        const db = activeConnections.get(socket.id);
        if (db) { await db.disconnect(); activeConnections.delete(socket.id); }
        console.log('Client disconnected:', socket.id);
    });
});

// Logout
app.post('/logout', (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
});

// ============================================================
//  AUTO BACKUP SCHEDULER — MULTI-PROFILE
// ============================================================
const activeCronJobs = new Map(); // profileId → cron job

function getCpuUsage() {
    const cpus = os.cpus();
    let idle = 0, total = 0;
    cpus.forEach(cpu => {
        for (const t in cpu.times) total += cpu.times[t];
        idle += cpu.times.idle;
    });
    return Math.max(0, 100 - ~~(100 * (idle / cpus.length) / (total / cpus.length)));
}

async function runProfileBackup(profile) {
    const cpuUsage = getCpuUsage();
    const cpuLimit = profile.cpuLimit || 80;
    if (cpuUsage > cpuLimit) {
        console.warn(`[Backup] Profile "${profile.name}" skipped: CPU ${cpuUsage}% > limit ${cpuLimit}%`);
        return;
    }

    const credentials = { ...profile.credentials };
    // Decrypt password if stored
    if (profile.credentialKey) {
        const pwd = await getSecureCredential(profile.credentialKey);
        if (pwd) credentials.password = pwd;
    }

    const databases = profile.databases || [];
    if (databases.length === 0) {
        console.warn(`[Backup] Profile "${profile.name}" has no databases configured`);
        return;
    }

    let dbManager;
    try {
        dbManager = new DatabaseManager(credentials);
        await dbManager.connect();

        for (const dbName of databases) {
            try {
                const result = await dbManager.exportDatabase(dbName, { exportMethod: 'single', format: 'sql', includeData: true });
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                // Sanitize profile name for filename
                const safeProfile = (profile.name || 'default').replace(/[^a-z0-9]/gi, '_').toLowerCase();
                const filename = `${dbName}__${safeProfile}__autobackup__${timestamp}.sql`;
                await fs.writeFile(path.join(BACKUPS_DIR, filename), result.content);
                console.log(`[Backup] ✓ ${filename}`);

                // Retention: keep only N backups per db+profile combination
                const retention = profile.retention || 5;
                const prefix = `${dbName}__${safeProfile}__autobackup__`;
                const all = await fs.readdir(BACKUPS_DIR);
                const mine = [];
                for (const f of all) {
                    if (f.startsWith(prefix)) {
                        const stat = await fs.stat(path.join(BACKUPS_DIR, f));
                        mine.push({ name: f, date: stat.mtimeMs });
                    }
                }
                mine.sort((a, b) => b.date - a.date);
                for (let i = retention; i < mine.length; i++) {
                    await fs.unlink(path.join(BACKUPS_DIR, mine[i].name));
                    console.log(`[Backup] Pruned old backup: ${mine[i].name}`);
                }
            } catch (dbErr) {
                console.error(`[Backup] Failed for DB "${dbName}" in profile "${profile.name}":`, dbErr.message);
            }
        }
    } catch (connErr) {
        console.error(`[Backup] Connection failed for profile "${profile.name}":`, connErr.message);
    } finally {
        if (dbManager) await dbManager.disconnect().catch(() => {});
    }
}

function setupAutoBackup() {
    // Stop all existing jobs
    for (const job of activeCronJobs.values()) job.stop();
    activeCronJobs.clear();

    let settings = {};
    if (fsSync.existsSync(SETTINGS_FILE)) {
        try { settings = JSON.parse(fsSync.readFileSync(SETTINGS_FILE, 'utf8')); } catch {}
    }

    const profiles = settings.backupProfiles || [];
    for (const profile of profiles) {
        if (!profile.enabled) continue;

        let cronExpr = '0 0 * * *'; // default: daily midnight
        if (profile.interval === 'hourly') cronExpr = '0 * * * *';
        else if (profile.interval === 'weekly') cronExpr = '0 0 * * 0';
        else if (profile.interval === 'custom' && profile.cronExpression) cronExpr = profile.cronExpression;

        try {
            const job = cron.schedule(cronExpr, () => runProfileBackup(profile));
            activeCronJobs.set(profile.id || profile.name, job);
            console.log(`[Backup] Scheduled profile "${profile.name}" (${cronExpr})`);
        } catch (e) {
            console.error(`[Backup] Invalid cron for profile "${profile.name}":`, e.message);
        }
    }
}

setupAutoBackup();

server.listen(PORT, () => {
    console.log(`\n⚡ DB Manager running at http://localhost:${PORT}\n`);
});
