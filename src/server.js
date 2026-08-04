require('dotenv').config();
const express = require('express');
const session = require('express-session');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');
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
    secret: 'your_secret_key',
    resave: false,
    saveUninitialized: true
});

app.use(sessionMiddleware);
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Share session with Socket.IO
io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increased limit for imports
app.use(express.static(path.join(__dirname, 'public')));
app.use('/backups', express.static(path.join(__dirname, '..', 'backups'))); // Serve backups for download

// Store active database connections
const activeConnections = new Map();

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Setup multer for backup uploads
const upload = multer({ dest: path.join(__dirname, '..', 'backups') });

// System Stats API
app.get('/api/system-stats', (req, res) => {
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;
    
    cpus.forEach(cpu => {
        for (let type in cpu.times) {
            totalTick += cpu.times[type];
        }
        totalIdle += cpu.times.idle;
    });
    
    const idle = totalIdle / cpus.length;
    const total = totalTick / cpus.length;
    
    // CPU usage estimation
    const usage = 100 - ~~(100 * idle / total);
    
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memUsage = (usedMem / totalMem) * 100;

    res.json({
        cpuUsage: usage,
        memUsage: memUsage.toFixed(2),
        totalMem: (totalMem / 1024 / 1024 / 1024).toFixed(2) + ' GB',
        usedMem: (usedMem / 1024 / 1024 / 1024).toFixed(2) + ' GB'
    });
});

// Upload Backup Endpoint
app.post('/api/upload-backup', upload.single('backupFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Rename to keep original name if possible
    const originalName = req.file.originalname;
    const newPath = path.join(__dirname, '..', 'backups', originalName);
    
    try {
        await fs.rename(req.file.path, newPath);
        res.json({ success: true, message: 'Backup uploaded successfully', filename: originalName });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save uploaded file' });
    }
});

// Settings Management
const SETTINGS_FILE = path.join(__dirname, 'data', 'settings.json');
const QUERY_HISTORY_FILE = path.join(__dirname, 'data', 'query_history.json');

// Ensure data dirs exist
if (!fsSync.existsSync(path.join(__dirname, 'data'))) {
    fsSync.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}
if (!fsSync.existsSync(path.join(__dirname, '..', 'backups'))) {
    fsSync.mkdirSync(path.join(__dirname, '..', 'backups'), { recursive: true });
}

// API to get last credentials from session
// API to get last credentials from session (now via JWT)
const JWT_SECRET = process.env.JWT_SECRET_KEY || 'your_fallback_secret_key_change_in_production';

// API to get last credentials from session (now via JWT)
app.get('/session-credentials', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.json({});
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
        return res.json({});
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        res.json({
            host: decoded.host,
            port: decoded.port,
            username: decoded.username,
            password: decoded.password,
            database: decoded.database,
            ssl: decoded.ssl,
            engine: decoded.engine
        });
    } catch (err) {
        // Invalid or expired token
        res.json({});
    }
});

// API to store credentials in session (now generate JWT)
app.post('/store-credentials', (req, res) => {
    const { host, port, username, password, database, ssl, engine } = req.body;

    // Create payload
    const payload = {
        host,
        port,
        username,
        password,
        database,
        ssl,
        engine
    };

    // Sign token
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

    res.json({ success: true, token });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Handle database connection
    socket.on('connect_database', async (credentials) => {
        try {
            const dbManager = new DatabaseManager(credentials);
            await dbManager.connect();

            activeConnections.set(socket.id, dbManager);

            socket.emit('connection_success', {
                message: 'Successfully connected to database',
                connectionId: socket.id
            });

            console.log(`Database connected for user: ${socket.id}`);
        } catch (error) {
            socket.emit('connection_error', {
                message: 'Failed to connect to database',
                error: error.message
            });
            console.error('Database connection error:', error.message);
        }
    });

    // Handle database disconnection
    socket.on('disconnect_database', async () => {
        const dbManager = activeConnections.get(socket.id);
        if (dbManager) {
            await dbManager.disconnect();
            activeConnections.delete(socket.id);
            socket.emit('disconnection_success', {
                message: 'Database disconnected successfully'
            });
        }
    });

    // Get all databases
    socket.on('get_databases', async () => {
        const dbManager = activeConnections.get(socket.id);
        if (!dbManager) {
            socket.emit('error', { message: 'No active database connection' });
            return;
        }

        try {
            const databases = await dbManager.getDatabases();
            socket.emit('databases_list', databases);
        } catch (error) {
            socket.emit('error', { message: error.message });
        }
    });

    // Get tables from a specific database
    socket.on('get_tables', async (databaseName) => {
        const dbManager = activeConnections.get(socket.id);
        if (!dbManager) {
            socket.emit('error', { message: 'No active database connection' });
            return;
        }

        try {
            const tables = await dbManager.getTables(databaseName);
            socket.emit('tables_list', { database: databaseName, tables });
        } catch (error) {
            socket.emit('error', { message: error.message });
        }
    });

    // Get table structure
    socket.on('get_table_structure', async ({ database, table }) => {
        const dbManager = activeConnections.get(socket.id);
        if (!dbManager) {
            socket.emit('error', { message: 'No active database connection' });
            return;
        }

        try {
            const structure = await dbManager.getTableStructure(database, table);
            socket.emit('table_structure', { database, table, structure });
        } catch (error) {
            socket.emit('error', { message: error.message });
        }
    });

    // Get table data
    socket.on('get_table_data', async ({ database, table, limit = 100, offset = 0, sortColumn = null, sortDirection = 'ASC', searchFilters = null, searchLogic = 'AND' }) => {
        const dbManager = activeConnections.get(socket.id);
        if (!dbManager) {
            socket.emit('error', { message: 'No active database connection' });
            return;
        }

        try {
            const result = await dbManager.getTableData(database, table, limit, offset, sortColumn, sortDirection, searchFilters, searchLogic);
            // Send the result directly, adding database and table info
            socket.emit('table_data', {
                database,
                table,
                data: result.data,
                total: result.total,
                limit: result.limit,
                offset: result.offset,
                sortColumn: result.sortColumn,
                sortDirection: result.sortDirection,
                searchFilters: result.searchFilters,
                searchLogic: result.searchLogic
            });
        } catch (error) {
            socket.emit('error', { message: error.message });
        }
    });

    // Execute custom SQL query
    socket.on('execute_query', async ({ database, query }) => {
        const dbManager = activeConnections.get(socket.id);
        if (!dbManager) {
            socket.emit('error', { message: 'No active database connection' });
            return;
        }

        try {
            const result = await dbManager.executeQuery(database, query);
            socket.emit('query_result', { query, result });
        } catch (error) {
            // Emitting specific query error for logging
            socket.emit('query_execution_error', {
                message: error.message,
                query: query,
                database: database
            });
            // Also emit standard error for notification if needed, or we might just use the log
            // Keeping standard error for now as it triggers a notification, but we might want to suppress it if the log is enough
            // decided to keep both: immediate notification + persistent log
            socket.emit('error', { message: error.message });
        }
    });

    // Create new database
    socket.on('create_database', async (databaseName) => {
        const dbManager = activeConnections.get(socket.id);
        if (!dbManager) {
            socket.emit('error', { message: 'No active database connection' });
            return;
        }

        try {
            await dbManager.createDatabase(databaseName);
            socket.emit('database_created', { message: `Database '${databaseName}' created successfully` });
        } catch (error) {
            socket.emit('error', { message: error.message });
        }
    });

    // Drop database
    socket.on('drop_database', async (databaseName) => {
        const dbManager = activeConnections.get(socket.id);
        if (!dbManager) {
            socket.emit('error', { message: 'No active database connection' });
            return;
        }

        try {
            await dbManager.dropDatabase(databaseName);
            socket.emit('database_dropped', { message: `Database '${databaseName}' dropped successfully` });
        } catch (error) {
            socket.emit('error', { message: error.message });
        }
    });

    // Alter table
    socket.on('alter_table', async ({ database, table, alterQuery }) => {
        const dbManager = activeConnections.get(socket.id);
        if (!dbManager) {
            socket.emit('error', { message: 'No active database connection' });
            return;
        }

        try {
            await dbManager.alterTable(database, table, alterQuery);
            socket.emit('table_altered', { message: `Table '${table}' altered successfully` });
        } catch (error) {
            socket.emit('error', { message: error.message });
        }
    });

    // Get table indexes
    socket.on('get_table_indexes', async ({ database, table }) => {
        const dbManager = activeConnections.get(socket.id);
        if (!dbManager) {
            socket.emit('error', { message: 'No active database connection' });
            return;
        }

        try {
            const indexes = await dbManager.getTableIndexes(database, table);
            socket.emit('table_indexes', { database, table, indexes });
        } catch (error) {
            socket.emit('error', { message: error.message });
        }
    });

    // Get table constraints
    socket.on('get_table_constraints', async ({ database, table }) => {
        const dbManager = activeConnections.get(socket.id);
        if (!dbManager) {
            socket.emit('error', { message: 'No active database connection' });
            return;
        }

        try {
            const constraints = await dbManager.getTableConstraints(database, table);
            socket.emit('table_constraints', { database, table, constraints });
        } catch (error) {
            socket.emit('error', { message: error.message });
        }
    });

    // Drop table
    socket.on('drop_table', async ({ database, table }) => {
        const dbManager = activeConnections.get(socket.id);
        if (!dbManager) {
            socket.emit('error', { message: 'No active database connection' });
            return;
        }

        try {
            await dbManager.dropTable(database, table);
            socket.emit('table_dropped', { message: `Table '${table}' dropped successfully` });
        } catch (error) {
            socket.emit('error', { message: error.message });
        }
    });

    // Export database
    socket.on('export_database', async ({ database, options = {} }) => {
        const dbManager = activeConnections.get(socket.id);
        if (!dbManager) {
            socket.emit('error', { message: 'No active database connection' });
            return;
        }

        try {
            const exportResult = await dbManager.exportDatabase(database, options);
            socket.emit('database_exported', exportResult);
        } catch (error) {
            socket.emit('error', { message: error.message });
        }
    });

    // Export table
    socket.on('export_table', async ({ database, table, options = {} }) => {
        const dbManager = activeConnections.get(socket.id);
        if (!dbManager) {
            socket.emit('error', { message: 'No active database connection' });
            return;
        }

        try {
            const tableContent = await dbManager.exportTable(database, table, options);
            const ext = options.format === 'json' ? 'json' : 'sql';
            const exportResult = {
                filename: `${table}_export_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.${ext}`,
                content: tableContent,
                size: Buffer.byteLength(tableContent, 'utf8')
            };
            socket.emit('table_exported', exportResult);
        } catch (error) {
            socket.emit('error', { message: error.message });
        }
    });

    // Get row count for export preview
    socket.on('get_row_count', async ({ database, table, whereClause = null }) => {
        const dbManager = activeConnections.get(socket.id);
        if (!dbManager) {
            socket.emit('error', { message: 'No active database connection' });
            return;
        }

        try {
            const count = await dbManager.getRowCount(database, table, whereClause);
            socket.emit('row_count_result', { database, table, count, whereClause });
        } catch (error) {
            socket.emit('error', { message: error.message });
        }
    });

    // Delete all data
    socket.on('delete_all_data', async ({ database, table }) => {
        const dbManager = activeConnections.get(socket.id);
        if (!dbManager) {
            socket.emit('error', { message: 'No active database connection' });
            return;
        }

        try {
            await dbManager.deleteAllData(database, table);
            socket.emit('data_deleted', { message: `All data deleted from table '${table}'` });
        } catch (error) {
            socket.emit('error', { message: error.message });
        }
    });

    // Update row
    socket.on('update_row', async ({ database, table, primaryKeyColumn, primaryKeyValue, updateData }) => {
        const dbManager = activeConnections.get(socket.id);
        if (!dbManager) {
            socket.emit('error', { message: 'No active database connection' });
            return;
        }

        try {
            await dbManager.updateRow(database, table, primaryKeyColumn, primaryKeyValue, updateData);
            socket.emit('row_updated', { message: 'Row updated successfully' });
        } catch (error) {
            socket.emit('error', { message: error.message });
        }
    });

    // Delete selected data
    socket.on('delete_selected_data', async ({ database, table, targetColumn, targetValues }) => {
        const dbManager = activeConnections.get(socket.id);
        if (!dbManager) {
            socket.emit('error', { message: 'No active database connection' });
            return;
        }

        try {
            await dbManager.deleteRows(database, table, targetColumn, targetValues);
            socket.emit('data_deleted', { message: `${targetValues.length} rows deleted from table '${table}'` });
        } catch (error) {
            socket.emit('error', { message: error.message });
        }
    });

    // Import database
    socket.on('import_database', async ({ database, content, type }) => {
        const dbManager = activeConnections.get(socket.id);
        if (!dbManager) {
            socket.emit('error', { message: 'No active database connection' });
            return;
        }

        try {
            if (type === 'json') {
                await dbManager.importDatabaseFromJson(database, content);
            } else {
                await dbManager.importDatabase(database, content);
            }
            socket.emit('database_imported', { message: 'Database imported successfully' });
        } catch (error) {
            socket.emit('error', { message: error.message });
        }
    });

    // Insert row
    socket.on('insert_row', async ({ database, table, rowData }) => {
        const dbManager = activeConnections.get(socket.id);
        if (!dbManager) {
            socket.emit('error', { message: 'No active database connection' });
            return;
        }

        try {
            await dbManager.insertRow(database, table, rowData);
            socket.emit('row_inserted', { message: 'Row inserted successfully' });
        } catch (error) {
            socket.emit('error', { message: error.message });
        }
    });

    // Get DB sizes
    socket.on('get_db_sizes', async () => {
        const dbManager = activeConnections.get(socket.id);
        if (!dbManager) return;
        try {
            const sizes = await dbManager.getDatabaseSizes();
            socket.emit('db_sizes', sizes);
        } catch (err) {
            console.error(err);
        }
    });

    // Get Table sizes
    socket.on('get_table_sizes', async (database) => {
        const dbManager = activeConnections.get(socket.id);
        if (!dbManager) return;
        try {
            const sizes = await dbManager.getTableSizes(database);
            socket.emit('table_sizes', { database, sizes });
        } catch (err) {
            console.error(err);
        }
    });

    // Backup Settings
    socket.on('get_settings', async () => {
        try {
            let settings = {};
            if (fsSync.existsSync(SETTINGS_FILE)) {
                settings = JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf8'));
            }
            socket.emit('settings', settings);
        } catch (err) {
            console.error(err);
        }
    });

    socket.on('save_settings', async (settings) => {
        try {
            await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
            socket.emit('settings_saved', { message: 'Settings saved' });
            // Restart cron if auto backup changed
            setupAutoBackup();
        } catch (err) {
            socket.emit('error', { message: 'Failed to save settings' });
        }
    });

    // Backup Management
    socket.on('list_backups', async () => {
        try {
            const backupsDir = path.join(__dirname, '..', 'backups');
            if (!fsSync.existsSync(backupsDir)) {
                socket.emit('backups_list', []);
                return;
            }
            const files = await fs.readdir(backupsDir);
            const backups = [];
            for (const file of files) {
                const stat = await fs.stat(path.join(backupsDir, file));
                if (stat.isFile()) {
                    backups.push({
                        name: file,
                        size: stat.size,
                        date: stat.mtime
                    });
                }
            }
            backups.sort((a, b) => b.date - a.date);
            socket.emit('backups_list', backups);
        } catch (err) {
            socket.emit('error', { message: 'Failed to list backups' });
        }
    });

    socket.on('delete_backup', async (filename) => {
        try {
            await fs.unlink(path.join(__dirname, '..', 'backups', filename));
            socket.emit('backup_deleted', { message: `Deleted ${filename}` });
        } catch (err) {
            socket.emit('error', { message: 'Failed to delete backup' });
        }
    });
    
    socket.on('restore_backup', async ({ filename, targetDatabase }) => {
        const dbManager = activeConnections.get(socket.id);
        if (!dbManager) {
            socket.emit('error', { message: 'No active database connection' });
            return;
        }

        try {
            const filePath = path.join(__dirname, '..', 'backups', filename);
            const content = await fs.readFile(filePath, 'utf8');
            if (filename.endsWith('.json')) {
                await dbManager.importDatabaseFromJson(targetDatabase, content);
            } else if (filename.endsWith('.sql')) {
                await dbManager.importDatabase(targetDatabase, content);
            } else {
                throw new Error('Unsupported backup format for direct restore');
            }
            socket.emit('backup_restored', { message: `Restored ${filename} to ${targetDatabase}` });
        } catch (error) {
            socket.emit('error', { message: `Failed to restore backup: ${error.message}` });
        }
    });

    // Query History
    socket.on('get_query_history', async () => {
        try {
            if (fsSync.existsSync(QUERY_HISTORY_FILE)) {
                const history = JSON.parse(await fs.readFile(QUERY_HISTORY_FILE, 'utf8'));
                socket.emit('query_history', history);
            } else {
                socket.emit('query_history', []);
            }
        } catch (err) {
            console.error(err);
        }
    });

    socket.on('save_query_history', async (queryObj) => {
        try {
            let history = [];
            if (fsSync.existsSync(QUERY_HISTORY_FILE)) {
                history = JSON.parse(await fs.readFile(QUERY_HISTORY_FILE, 'utf8'));
            }
            history.unshift({
                ...queryObj,
                timestamp: new Date().toISOString()
            });
            if (history.length > 200) history = history.slice(0, 200); // keep max 200
            await fs.writeFile(QUERY_HISTORY_FILE, JSON.stringify(history, null, 2));
            socket.emit('query_history', history);
        } catch (err) {
            console.error(err);
        }
    });
    
    socket.on('clear_query_history', async () => {
        try {
            await fs.writeFile(QUERY_HISTORY_FILE, JSON.stringify([]));
            socket.emit('query_history', []);
        } catch (err) {
            console.error(err);
        }
    });

    // Handle client disconnect
    socket.on('disconnect', async () => {
        console.log('User disconnected:', socket.id);
        const dbManager = activeConnections.get(socket.id);
        if (dbManager) {
            await dbManager.disconnect();
            activeConnections.delete(socket.id);
        }
    });
});

// Logout route
app.post('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).json({ success: false, message: 'Logout failed' });
        }
        res.json({ success: true });
    });
});

let currentCronJob = null;

function setupAutoBackup() {
    if (currentCronJob) {
        currentCronJob.stop();
        currentCronJob = null;
    }

    let settings = {};
    if (fsSync.existsSync(SETTINGS_FILE)) {
        try {
            settings = JSON.parse(fsSync.readFileSync(SETTINGS_FILE, 'utf8'));
        } catch (e) {}
    }

    if (settings.autoBackup && settings.autoBackup.enabled) {
        let cronExpr = '0 0 * * *'; // Daily at midnight default
        if (settings.autoBackup.interval === 'hourly') cronExpr = '0 * * * *';
        else if (settings.autoBackup.interval === 'weekly') cronExpr = '0 0 * * 0';
        else if (settings.autoBackup.cronExpression) cronExpr = settings.autoBackup.cronExpression;

        currentCronJob = cron.schedule(cronExpr, async () => {
            console.log('Running scheduled auto backup...');
            
            // Check CPU usage limit
            const cpus = os.cpus();
            let totalIdle = 0;
            let totalTick = 0;
            cpus.forEach(cpu => {
                for (let type in cpu.times) totalTick += cpu.times[type];
                totalIdle += cpu.times.idle;
            });
            const usage = 100 - ~~(100 * (totalIdle / cpus.length) / (totalTick / cpus.length));
            const limit = settings.autoBackup.cpuLimit || 80;
            
            if (usage > limit) {
                console.warn(`Auto backup skipped: CPU usage ${usage}% > limit ${limit}%`);
                return;
            }

            try {
                // Determine which connection to use (or instantiate a new one based on saved credentials if available)
                const credentials = settings.autoBackup.credentials;
                if (!credentials) {
                    console.error('Auto backup failed: No credentials saved in settings');
                    return;
                }

                const dbManager = new DatabaseManager(credentials);
                await dbManager.connect();
                
                const dbName = credentials.database;
                if (!dbName) {
                    console.error('Auto backup failed: No target database specified in credentials');
                    await dbManager.disconnect();
                    return;
                }
                
                const result = await dbManager.exportDatabase(dbName, { exportMethod: 'single', format: 'sql', includeData: true });
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const filename = `${dbName}_autobackup_${timestamp}.sql`;
                const filePath = path.join(__dirname, '..', 'backups', filename);
                
                await fs.writeFile(filePath, result.content);
                console.log(`Auto backup completed: ${filename}`);
                
                // Keep only N recent backups
                const retention = settings.autoBackup.retention || 5;
                const backupsDir = path.join(__dirname, '..', 'backups');
                const files = await fs.readdir(backupsDir);
                const backups = [];
                for (const file of files) {
                    if (file.includes('_autobackup_')) {
                        const stat = await fs.stat(path.join(backupsDir, file));
                        backups.push({ name: file, date: stat.mtimeMs });
                    }
                }
                backups.sort((a, b) => b.date - a.date); // newest first
                
                if (backups.length > retention) {
                    for (let i = retention; i < backups.length; i++) {
                        await fs.unlink(path.join(backupsDir, backups[i].name));
                        console.log(`Deleted old backup: ${backups[i].name}`);
                    }
                }
                
                await dbManager.disconnect();
            } catch (err) {
                console.error('Auto backup error:', err.message);
            }
        });
    }
}

// Initial setup of auto backup
setupAutoBackup();

// Start server
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Access the application at http://localhost:${PORT}`);
});
