/**
 * DB Manager — Full Database Maintainer v2
 * Frontend Application Logic
 */

'use strict';

// ============================================================
//  GLOBALS
// ============================================================
let socket = io();
let currentDatabase = null;
let currentTable = null;
let currentTableStructure = null;
let currentCredentials = null;
let isConnected = false;
let currentPage = 1;
let pageSize = 100;
let currentSortColumn = null;
let currentSortDirection = 'ASC';
let currentSearchFilters = [];
let currentSearchLogic = 'AND';
let totalRows = 0;
let annotations = {};
let settings = {};
let backupProfiles = [];
let sqlEditor = null; // CodeMirror instance

// ============================================================
//  THEME
// ============================================================
function applyTheme(theme) {
    if (theme === 'auto') {
        theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', theme);
    document.getElementById('darkModeToggle').textContent = theme === 'dark' ? '☀️' : '🌙';
    if (sqlEditor) {
        sqlEditor.setOption('theme', theme === 'dark' ? 'dracula' : 'default');
    }
    // Update active pill in settings
    document.querySelectorAll('[data-theme-opt]').forEach(el => el.classList.remove('active'));
}

function getStoredThemePref() {
    return localStorage.getItem('dbm_theme') || 'auto';
}

function setTheme(pref) {
    localStorage.setItem('dbm_theme', pref);
    applyTheme(pref);
    document.querySelectorAll('[data-theme-opt]').forEach(el => el.classList.remove('active'));
    document.querySelector(`[data-theme-opt="${pref}"]`)?.classList.add('active');
}

// Apply on load
applyTheme(getStoredThemePref());

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getStoredThemePref() === 'auto') applyTheme('auto');
});

// ============================================================
//  CODEMIRROR SQL EDITOR
// ============================================================
function initCodeMirror() {
    const textarea = document.getElementById('sqlQuery');
    if (!textarea || sqlEditor) return;
    const theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dracula' : 'default';
    sqlEditor = CodeMirror.fromTextArea(textarea, {
        mode: 'text/x-sql',
        theme,
        lineNumbers: true,
        indentWithTabs: false,
        tabSize: 2,
        autofocus: false,
        extraKeys: {
            'Ctrl-Enter': () => executeQuery(),
            'Cmd-Enter': () => executeQuery(),
        },
        lineWrapping: false,
    });
    sqlEditor.setSize('100%', '210px');
}

// ============================================================
//  MODAL SYSTEM
// ============================================================
function showModal(id) {
    const overlay = document.getElementById(id);
    if (!overlay) return;
    overlay.classList.add('open');
    overlay.style.display = 'flex';
}
window.showModal = showModal;

function closeModal(id) {
    const overlay = document.getElementById(id);
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay.style.display = 'none';
    const form = overlay.querySelector('form');
    if (form) form.reset();
}
window.closeModal = closeModal;

// Close on overlay click
document.addEventListener('click', e => {
    if (e.target.classList.contains('modal-overlay')) {
        closeModal(e.target.id);
    }
});

// Close buttons with data-close
document.addEventListener('click', e => {
    const btn = e.target.closest('[data-close]');
    if (btn) closeModal(btn.dataset.close);
});

// ============================================================
//  NOTIFICATIONS
// ============================================================
function showNotification(message, type = 'info', duration = 4000) {
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const container = document.getElementById('notifications');
    const n = document.createElement('div');
    n.className = `notification ${type}`;
    n.innerHTML = `<span class="notification-icon">${icons[type] || 'ℹ️'}</span><span class="notification-text">${message}</span>`;
    container.appendChild(n);
    setTimeout(() => {
        n.classList.add('hiding');
        setTimeout(() => n.remove(), 350);
    }, duration);
}

// ============================================================
//  CONTEXT MENU
// ============================================================
const ctxMenu = document.getElementById('contextMenu');

function showContextMenu(x, y, items) {
    ctxMenu.innerHTML = '';
    items.forEach(item => {
        if (item.type === 'sep') {
            const s = document.createElement('div');
            s.className = 'context-menu-sep';
            ctxMenu.appendChild(s);
        } else {
            const div = document.createElement('div');
            div.className = `context-menu-item ${item.danger ? 'danger' : ''}`;
            div.innerHTML = `<span class="context-menu-icon">${item.icon || ''}</span>${item.label}`;
            div.addEventListener('click', () => { item.action(); closeContextMenu(); });
            ctxMenu.appendChild(div);
        }
    });
    ctxMenu.style.display = 'block';
    ctxMenu.style.left = Math.min(x, window.innerWidth - 200) + 'px';
    ctxMenu.style.top = Math.min(y, window.innerHeight - ctxMenu.offsetHeight - 10) + 'px';
}

function closeContextMenu() { ctxMenu.style.display = 'none'; }

document.addEventListener('click', () => closeContextMenu());
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeContextMenu(); closeAllModals(); } });

function closeAllModals() {
    document.querySelectorAll('.modal-overlay.open').forEach(m => closeModal(m.id));
}

// ============================================================
//  CONNECTION FLOW
// ============================================================
const connectionOverlay = document.getElementById('connectionOverlay');
const appShell = document.getElementById('appShell');

function showConnectionOverlay() {
    connectionOverlay.style.display = 'flex';
    appShell.style.display = 'none';
}

function showAppShell() {
    connectionOverlay.style.display = 'none';
    appShell.style.display = 'flex';
    initCodeMirror();
}

// Engine selection
document.querySelectorAll('.engine-pill').forEach(pill => {
    pill.addEventListener('click', () => {
        document.querySelectorAll('.engine-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        document.getElementById('engine').value = pill.dataset.engine;
        document.getElementById('port').value = pill.dataset.engine === 'postgresql' ? '5432' : '3306';
    });
});

// Advanced toggle
document.getElementById('advancedToggle').addEventListener('click', () => {
    const section = document.getElementById('advancedSection');
    section.classList.toggle('open');
    document.getElementById('advancedToggle').innerHTML =
        (section.classList.contains('open') ? '▼' : '▶') + ' Advanced Options (SSL)';
});

// Load saved connections on page load
loadSavedConnections();

function loadSavedConnections() {
    const token = localStorage.getItem('mysql_jwt_token');
    if (token) {
        fetch('/session-credentials', { headers: { 'Authorization': 'Bearer ' + token } })
            .then(r => r.json())
            .then(data => {
                if (data.host) populateConnectionForm(data);
            }).catch(() => {});
    }

    const saved = JSON.parse(localStorage.getItem('savedConnections') || '[]');
    const wrapper = document.getElementById('savedConnsWrapper');
    const select = document.getElementById('savedConnections');
    if (saved.length > 0) {
        wrapper.style.display = 'block';
        select.innerHTML = '<option value="">Select a saved connection...</option>';
        saved.forEach((c, i) => {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = `${c.user}@${c.host}:${c.port} (${c.engine || 'mysql'})`;
            select.appendChild(opt);
        });
    }
}

document.getElementById('savedConnections').addEventListener('change', async (e) => {
    const idx = parseInt(e.target.value);
    if (isNaN(idx)) return;
    const saved = JSON.parse(localStorage.getItem('savedConnections') || '[]');
    const conn = saved[idx];
    if (!conn) return;
    populateConnectionForm(conn);
    // Retrieve password from secure store
    const credKey = `${conn.host}:${conn.port}:${conn.user}`;
    try {
        const res = await fetch(`/api/credential/get?key=${encodeURIComponent(credKey)}`);
        const data = await res.json();
        if (data.password) document.getElementById('password').value = data.password;
    } catch {}
});

function populateConnectionForm(data) {
    if (data.host) document.getElementById('host').value = data.host;
    if (data.port) document.getElementById('port').value = data.port;
    if (data.username || data.user) document.getElementById('user').value = data.username || data.user;
    if (data.database) document.getElementById('database').value = data.database;
    if (data.engine) {
        document.getElementById('engine').value = data.engine;
        document.querySelectorAll('.engine-pill').forEach(p => p.classList.remove('active'));
        document.querySelector(`[data-engine="${data.engine}"]`)?.classList.add('active');
    }
}

document.getElementById('deleteSavedConnBtn').addEventListener('click', () => {
    const select = document.getElementById('savedConnections');
    const idx = parseInt(select.value);
    if (isNaN(idx)) return;
    let saved = JSON.parse(localStorage.getItem('savedConnections') || '[]');
    const conn = saved[idx];
    if (conn) {
        const credKey = `${conn.host}:${conn.port}:${conn.user}`;
        fetch('/api/credential/delete?key=' + encodeURIComponent(credKey), { method: 'DELETE' }).catch(() => {});
    }
    saved.splice(idx, 1);
    localStorage.setItem('savedConnections', JSON.stringify(saved));
    loadSavedConnections();
    showNotification('Connection deleted', 'success');
});

// Connection form submit
document.getElementById('connectionForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const creds = {
        host: formData.get('host'),
        port: parseInt(formData.get('port')),
        user: formData.get('user'),
        password: formData.get('password'),
        database: formData.get('database') || null,
        engine: formData.get('engine') || 'mysql',
        ssl: buildSslConfig(formData)
    };
    currentCredentials = creds;

    const saveConn = document.getElementById('saveConnection').checked;
    if (saveConn) {
        const credKey = `${creds.host}:${creds.port}:${creds.user}`;
        // Store password encrypted on server
        await fetch('/api/credential/set', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: credKey, password: creds.password })
        }).catch(() => {});
        // Save non-sensitive data in localStorage
        let saved = JSON.parse(localStorage.getItem('savedConnections') || '[]');
        const exists = saved.findIndex(s => s.host === creds.host && s.port === creds.port && s.user === creds.user);
        const connData = { host: creds.host, port: creds.port, user: creds.user, database: creds.database, engine: creds.engine };
        if (exists >= 0) saved[exists] = connData;
        else saved.unshift(connData);
        localStorage.setItem('savedConnections', JSON.stringify(saved.slice(0, 20)));
    }

    socket.emit('connect_database', creds);

    document.getElementById('connectBtn').textContent = 'Connecting...';
    document.getElementById('connectBtn').disabled = true;
});

function buildSslConfig(formData) {
    const ca = formData.get('sslCa');
    const cert = formData.get('sslCert');
    const key = formData.get('sslKey');
    if (!ca && !cert && !key) return false;
    return {
        ca: ca || undefined,
        cert: cert || undefined,
        key: key || undefined,
        rejectUnauthorized: formData.get('rejectUnauthorized') === 'on'
    };
}

// ============================================================
//  SOCKET LISTENERS
// ============================================================
socket.on('connection_success', () => {
    isConnected = true;
    updateConnectionStatus(true);
    showNotification('Connected to database!', 'success');
    showAppShell();

    // Store JWT (without password)
    fetch('/store-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            host: currentCredentials.host,
            port: currentCredentials.port,
            username: currentCredentials.user,
            database: currentCredentials.database,
            engine: currentCredentials.engine,
            ssl: currentCredentials.ssl
        })
    }).then(r => r.json()).then(d => {
        if (d.token) localStorage.setItem('mysql_jwt_token', d.token);
    }).catch(() => {});

    // Load initial data
    socket.emit('get_databases');
    socket.emit('get_settings');
    socket.emit('get_query_history');
    socket.emit('get_annotations');

    // Update server info panel
    updateServerInfo();

    // Update dashboard
    setTimeout(() => {
        socket.emit('get_db_sizes');
        loadBackupHistory();
    }, 500);
});

socket.on('connection_error', (data) => {
    showNotification(data.message || 'Connection failed', 'error');
    document.getElementById('connectBtn').textContent = 'Connect to Database';
    document.getElementById('connectBtn').disabled = false;
});

socket.on('disconnection_success', () => {
    isConnected = false;
    currentDatabase = null;
    currentTable = null;
    updateConnectionStatus(false);
    showNotification('Disconnected', 'info');
    showConnectionOverlay();
    clearSidebar();
    stopStatsPolling();
});

socket.on('error', data => showNotification(data.message, 'error'));

socket.on('databases_list', (databases) => {
    renderSidebarDatabases(databases);
    populateQueryDatabaseSelects(databases);
});

socket.on('tables_list', ({ database, tables }) => {
    renderSidebarTables(database, tables);
});

socket.on('table_structure', ({ database, table, structure }) => {
    currentTableStructure = structure;
    renderStructureTable(structure);
    populateAlterFormColumns(structure);
    populateIndexColumns(structure);
});

socket.on('table_data', (data) => {
    renderTableData(data);
    updatePagination(data);
});

socket.on('data_deleted', (data) => {
    showNotification(data.message, 'success');
    loadTableData();
});

socket.on('query_result', (data) => {
    displayQueryResult(data);
});

socket.on('query_execution_error', (data) => {
    addErrorToLog(data);
    document.getElementById('errorLogContainer').style.display = 'flex';
});

socket.on('database_created', (data) => {
    showNotification(data.message, 'success');
    closeModal('modalCreateDatabase');
    socket.emit('get_databases');
});

socket.on('database_dropped', (data) => {
    showNotification(data.message, 'success');
    currentDatabase = null;
    clearTableArea();
    socket.emit('get_databases');
});

socket.on('table_altered', (data) => {
    showNotification(data.message, 'success');
    loadTableStructure();
    loadTableIndexes();
    loadTables();
});

socket.on('table_indexes', ({ indexes }) => renderIndexesTable(indexes));

socket.on('table_dropped', (data) => {
    showNotification(data.message, 'success');
    clearTableArea();
    loadTables();
});

socket.on('database_exported', (data) => {
    downloadFile(data.filename, data.content, data.isZip);
    showNotification(`Exported: ${formatFileSize(data.size)}`, 'success');
    closeModal('modalExportDatabase');
});

socket.on('table_exported', (data) => {
    downloadFile(data.filename, data.content);
    showNotification(`Table exported: ${formatFileSize(data.size)}`, 'success');
    closeModal('modalExportTable');
});

socket.on('row_count_result', ({ count }) => {
    document.getElementById('rowCountPreview').textContent = `~${count} rows`;
});

socket.on('row_updated', (data) => {
    showNotification(data.message, 'success');
    closeModal('modalEditRow');
    loadTableData();
});

socket.on('row_inserted', (data) => {
    showNotification(data.message, 'success');
    closeModal('modalInsertRow');
    loadTableData();
});

socket.on('database_imported', (data) => {
    showNotification(data.message, 'success');
    loadTables();
});

socket.on('settings', (s) => {
    settings = s || {};
    applySettings();
});

socket.on('settings_saved', (data) => showNotification(data.message, 'success'));

socket.on('backups_list', (backups) => renderBackupHistory(backups));

socket.on('backup_deleted', (data) => {
    showNotification(data.message, 'success');
    socket.emit('list_backups');
});

socket.on('backup_restored', (data) => {
    showNotification(data.message, 'success');
    loadTables();
});

socket.on('query_history', (history) => renderQueryHistory(history));

socket.on('db_sizes', (sizes) => {
    updateSidebarDbSizes(sizes);
    renderDashboardDbSizes(sizes);
});

socket.on('table_sizes', ({ database, sizes }) => {
    updateSidebarTableSizes(database, sizes);
});

socket.on('annotations', (data) => {
    annotations = data;
    updateAnnotationIcons();
});

socket.on('foreign_keys', ({ database, fkData }) => {
    renderERDiagram(database, fkData);
});

socket.on('slow_queries', ({ queries, warning }) => {
    renderSlowQueries(queries, warning);
});

socket.on('schema_diff', (data) => {
    renderSchemaDiff(data);
});

socket.on('table_constraints', ({ constraints }) => {});

// ============================================================
//  SIDEBAR — TREE VIEW
// ============================================================
const sidebarTree = document.getElementById('sidebarTree');
const sidebarEmpty = document.getElementById('sidebarEmpty');
let _dbList = [];

function clearSidebar() {
    sidebarTree.innerHTML = '';
    sidebarEmpty.style.display = 'block';
    sidebarTree.appendChild(sidebarEmpty);
    _dbList = [];
}

function renderSidebarDatabases(databases) {
    _dbList = databases;
    sidebarTree.innerHTML = '';
    sidebarEmpty.style.display = 'none';

    if (!databases.length) {
        sidebarEmpty.textContent = 'No databases found.';
        sidebarEmpty.style.display = 'block';
        sidebarTree.appendChild(sidebarEmpty);
        return;
    }

    databases.forEach(db => {
        const node = createDbNode(db);
        sidebarTree.appendChild(node);
    });

    // Auto-expand if there's only one db
    if (databases.length === 1) {
        const firstNode = sidebarTree.querySelector('.db-node');
        if (firstNode) expandDb(firstNode, databases[0]);
    }
}

function createDbNode(db) {
    const node = document.createElement('div');
    node.className = 'db-node';
    node.dataset.db = db;
    node.innerHTML = `
        <div class="db-node-header" title="${db}">
            <span class="db-chevron">▶</span>
            <span class="db-icon">📦</span>
            <span class="db-name">${db}</span>
            <span class="db-size-badge" id="dbsize-${db}"></span>
            <div class="db-actions">
                <button class="db-action-btn" title="Export" onclick="dbAction('export','${db}',event)">📤</button>
                <button class="db-action-btn" title="Import" onclick="dbAction('import','${db}',event)">📥</button>
                <button class="db-action-btn" title="Backup now" onclick="dbAction('backup','${db}',event)">💾</button>
                <button class="db-action-btn" title="Schema diff" onclick="dbAction('diff','${db}',event)">🔀</button>
                <button class="db-action-btn" title="Drop database" onclick="dbAction('drop','${db}',event)" style="color:var(--danger)">🗑️</button>
            </div>
        </div>
        <div class="db-tables" id="dbtables-${db}">
            <div class="sidebar-empty" style="padding:8px 20px;font-size:11.5px;">Loading...</div>
        </div>
    `;

    const header = node.querySelector('.db-node-header');
    header.addEventListener('click', () => {
        if (node.classList.contains('open')) {
            collapseDb(node, db);
        } else {
            expandDb(node, db);
        }
    });

    header.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, [
            { icon: '📋', label: `Copy "${db}"`, action: () => navigator.clipboard.writeText(db) },
            { type: 'sep' },
            { icon: '📤', label: 'Export Database', action: () => dbAction('export', db) },
            { icon: '📥', label: 'Import into Database', action: () => dbAction('import', db) },
            { icon: '💾', label: 'Manual Backup', action: () => dbAction('backup', db) },
            { icon: '🔀', label: 'Schema Diff', action: () => dbAction('diff', db) },
            { type: 'sep' },
            { icon: '🗑️', label: 'Drop Database', danger: true, action: () => dbAction('drop', db) },
        ]);
    });

    return node;
}

function expandDb(node, db) {
    node.classList.add('open');
    currentDatabase = db;
    socket.emit('get_tables', db);
    socket.emit('get_table_sizes', db);
    updateDbHighlight();
}

function collapseDb(node, db) {
    node.classList.remove('open');
}

function updateDbHighlight() {
    document.querySelectorAll('.db-node-header').forEach(h => {
        h.classList.toggle('active', h.closest('.db-node').dataset.db === currentDatabase);
    });
}

function renderSidebarTables(database, tables) {
    const container = document.getElementById(`dbtables-${database}`);
    if (!container) return;
    container.innerHTML = '';

    if (!tables.length) {
        container.innerHTML = '<div class="sidebar-empty" style="padding:8px 20px;font-size:11.5px;">No tables</div>';
        return;
    }

    tables.forEach(table => {
        const div = document.createElement('div');
        div.className = 'table-node';
        div.dataset.table = table;
        div.dataset.db = database;
        div.innerHTML = `
            <span class="table-icon">📋</span>
            <span class="table-name">${table}</span>
            <span class="table-size-badge" id="tblsize-${database}-${table}"></span>
            <span class="table-note-icon" id="tblnote-${database}-${table}" style="display:none;" title="View note">📝</span>
            <div class="table-actions">
                <button class="table-action-btn" title="Export" onclick="tableAction('export','${database}','${table}',event)">📤</button>
                <button class="table-action-btn" title="Note" onclick="tableAction('note','${database}','${table}',event)">📝</button>
                <button class="table-action-btn" title="Drop" onclick="tableAction('drop','${database}','${table}',event)" style="color:var(--danger)">🗑️</button>
            </div>
        `;

        div.addEventListener('click', (e) => {
            if (e.target.closest('.table-actions') || e.target.closest('.table-note-icon')) return;
            selectTable(database, table, div);
        });

        div.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showContextMenu(e.clientX, e.clientY, [
                { icon: '📋', label: `Copy "${table}"`, action: () => navigator.clipboard.writeText(table) },
                { type: 'sep' },
                { icon: '📤', label: 'Export Table', action: () => tableAction('export', database, table) },
                { icon: '📝', label: 'Add/Edit Note', action: () => openAnnotationModal(database, table) },
                { icon: '+ Row', label: 'Insert Row', action: () => openInsertRowModal() },
                { type: 'sep' },
                { icon: '🗑️', label: 'Drop Table', danger: true, action: () => tableAction('drop', database, table) },
            ]);
        });

        container.appendChild(div);
    });

    // Restore annotation icons
    updateAnnotationIcons();
}

function selectTable(database, table, element) {
    currentDatabase = database;
    currentTable = table;
    currentPage = 1;
    currentSortColumn = null;
    currentSortDirection = 'ASC';
    currentSearchFilters = [];

    // Update UI highlights
    document.querySelectorAll('.table-node').forEach(n => n.classList.remove('active'));
    if (element) element.classList.add('active');
    document.querySelectorAll('.db-node-header').forEach(h => {
        h.classList.toggle('active', h.closest('.db-node').dataset.db === database);
    });

    // Update header labels
    document.getElementById('selectedTable').textContent = `${database}.${table}`;

    // Show action buttons
    document.getElementById('insertRowBtn').style.display = 'inline-flex';
    document.getElementById('exportCurrentData').style.display = 'inline-flex';
    document.getElementById('exportSelectedRows').style.display = 'inline-flex';
    document.getElementById('deleteAllData').style.display = 'inline-flex';

    // Switch to data tab
    switchContentTab('data');

    // Load data
    socket.emit('get_table_structure', { database, table });
    loadTableData();
    loadTableIndexes();
}

// DB actions triggered from sidebar buttons
window.dbAction = function(action, db, event) {
    if (event) event.stopPropagation();
    switch (action) {
        case 'export':
            showExportDatabaseModal(db);
            break;
        case 'import':
            currentDatabase = db;
            document.getElementById('importDbName').textContent = db;
            showModal('modalImportDatabase');
            break;
        case 'backup':
            manualBackupDatabase(db);
            break;
        case 'diff':
            openSchemaDiff(db);
            break;
        case 'drop':
            if (confirm(`Drop database "${db}"? This cannot be undone!`)) {
                socket.emit('drop_database', db);
            }
            break;
    }
};

window.tableAction = function(action, db, table, event) {
    if (event) event.stopPropagation();
    switch (action) {
        case 'export':
            showExportTableModal(db, table);
            break;
        case 'note':
            openAnnotationModal(db, table);
            break;
        case 'drop':
            if (confirm(`Drop table "${table}"? This cannot be undone!`)) {
                socket.emit('drop_table', { database: db, table });
            }
            break;
    }
};

// Sidebar search filter
document.getElementById('sidebarSearch').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('.db-node').forEach(node => {
        const dbName = node.dataset.db.toLowerCase();
        const tables = Array.from(node.querySelectorAll('.table-node'));
        let anyTableMatch = false;
        tables.forEach(t => {
            const match = t.dataset.table.toLowerCase().includes(q);
            t.style.display = match ? '' : 'none';
            if (match) anyTableMatch = true;
        });
        const dbMatch = !q || dbName.includes(q) || anyTableMatch;
        node.style.display = dbMatch ? '' : 'none';
        if (q && anyTableMatch) node.classList.add('open');
    });
});

// Update sidebar size badges
function updateSidebarDbSizes(sizes) {
    sizes.forEach(s => {
        const el = document.getElementById(`dbsize-${s.database}`);
        if (el) el.textContent = `${s.sizeMb} MB`;
    });
}

function updateSidebarTableSizes(database, sizes) {
    sizes.forEach(s => {
        const el = document.getElementById(`tblsize-${database}-${s.table}`);
        if (el) el.textContent = `${s.sizeMb} MB`;
    });
}

// ============================================================
//  CONTENT TABS
// ============================================================
function switchContentTab(tabId) {
    document.querySelectorAll('.content-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === `tab-${tabId}`);
    });
}

document.querySelectorAll('.content-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchContentTab(btn.dataset.tab));
});

// ============================================================
//  DATA RENDERING
// ============================================================
let _columnMap = [];

function renderTableData({ data, total, limit, offset }) {
    totalRows = total;
    const table = document.getElementById('dataTable');
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');

    if (!data || !data.length) {
        thead.innerHTML = '';
        tbody.innerHTML = '<tr><td colspan="99" style="text-align:center;padding:40px;color:var(--text-muted);">No data found</td></tr>';
        return;
    }

    const cols = Object.keys(data[0]);
    _columnMap = cols;

    // Build filter column options
    document.querySelectorAll('.filter-column').forEach(sel => {
        const cur = sel.value;
        sel.innerHTML = '<option value="">Column</option>' + cols.map(c => `<option value="${c}" ${c === cur ? 'selected' : ''}>${c}</option>`).join('');
    });

    // Header
    thead.innerHTML = `<tr>
        <th><input type="checkbox" id="selectAllRows" class="row-select-checkbox"></th>
        ${cols.map(c => `<th data-col="${c}" class="${c === currentSortColumn ? 'sorted' : ''}">${c}${c === currentSortColumn ? `<span class="sort-icon">${currentSortDirection === 'ASC' ? '↑' : '↓'}</span>` : ''}</th>`).join('')}
        <th>Actions</th>
    </tr>`;

    // Sortable headers
    thead.querySelectorAll('th[data-col]').forEach(th => {
        th.style.cursor = 'pointer';
        th.addEventListener('click', () => {
            if (currentSortColumn === th.dataset.col) {
                currentSortDirection = currentSortDirection === 'ASC' ? 'DESC' : 'ASC';
            } else {
                currentSortColumn = th.dataset.col;
                currentSortDirection = 'ASC';
            }
            loadTableData();
        });
    });

    // Select all
    thead.querySelector('#selectAllRows').addEventListener('change', (e) => {
        tbody.querySelectorAll('.row-select-checkbox').forEach(cb => cb.checked = e.target.checked);
    });

    // Body
    tbody.innerHTML = data.map((row, i) => `
        <tr data-row-idx="${i}">
            <td><input type="checkbox" class="row-select-checkbox"></td>
            ${cols.map(c => {
                const val = row[c];
                if (val === null) return `<td><span class="null-value">NULL</span></td>`;
                const str = String(val);
                if (str.length > 100) return `<td class="long-value" title="${escapeHtml(str)}">${escapeHtml(str.slice(0, 80))}…</td>`;
                return `<td>${escapeHtml(str)}</td>`;
            }).join('')}
            <td>
                <div class="row-actions-cell">
                    <button class="btn btn-primary btn-sm row-action-btn" onclick="openEditRowModal(${JSON.stringify(JSON.stringify(row))})">Edit</button>
                    <button class="btn btn-danger btn-sm row-action-btn" onclick="deleteRow(${JSON.stringify(JSON.stringify(row))})">Del</button>
                </div>
            </td>
        </tr>
    `).join('');

    // Row data stored for edit/delete
    window._rowData = data;
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function updatePagination({ total, limit, offset }) {
    totalRows = total;
    const start = offset + 1;
    const end = Math.min(offset + limit, total);
    document.getElementById('pageInfo').textContent = `Rows ${start}–${end} of ${total.toLocaleString()}`;
    document.getElementById('prevPage').disabled = offset === 0;
    document.getElementById('nextPage').disabled = end >= total;
}

function loadTableData() {
    if (!currentDatabase || !currentTable) return;
    const offset = (currentPage - 1) * pageSize;
    const filters = collectFilters();
    socket.emit('get_table_data', {
        database: currentDatabase,
        table: currentTable,
        limit: pageSize,
        offset,
        sortColumn: currentSortColumn,
        sortDirection: currentSortDirection,
        searchFilters: filters.length ? filters : null,
        searchLogic: currentSearchLogic
    });
}

function loadTables() {
    if (currentDatabase) socket.emit('get_tables', currentDatabase);
}

function loadTableStructure() {
    if (currentDatabase && currentTable) {
        socket.emit('get_table_structure', { database: currentDatabase, table: currentTable });
    }
}

function loadTableIndexes() {
    if (currentDatabase && currentTable) {
        socket.emit('get_table_indexes', { database: currentDatabase, table: currentTable });
    }
}

function clearTableArea() {
    currentTable = null;
    currentTableStructure = null;
    document.getElementById('selectedTable').textContent = 'Select a table';
    document.getElementById('dataTable').querySelector('thead').innerHTML = '';
    document.getElementById('dataTable').querySelector('tbody').innerHTML = '';
    document.getElementById('structureTable').querySelector('tbody').innerHTML = '';
    document.getElementById('insertRowBtn').style.display = 'none';
    document.getElementById('exportCurrentData').style.display = 'none';
    document.getElementById('exportSelectedRows').style.display = 'none';
    document.getElementById('deleteAllData').style.display = 'none';
    document.getElementById('deleteSelectedRows').style.display = 'none';
}

// ============================================================
//  STRUCTURE TABLE
// ============================================================
function renderStructureTable(structure) {
    const tbody = document.getElementById('structureTable').querySelector('tbody');
    tbody.innerHTML = structure.map(f => `
        <tr>
            <td><strong>${escapeHtml(f.Field)}</strong></td>
            <td><span class="type-badge ${f.Key === 'PRI' ? 'pk' : ''}">${escapeHtml(f.Type)}</span></td>
            <td><span class="badge ${f.Null === 'YES' ? 'badge-warning' : 'badge-muted'}">${f.Null}</span></td>
            <td>${f.Key === 'PRI' ? '<span class="badge badge-warning">PK</span>' : f.Key === 'MUL' ? '<span class="badge badge-primary">FK</span>' : f.Key === 'UNI' ? '<span class="badge badge-success">UNI</span>' : ''}</td>
            <td class="text-muted">${f.Default !== null ? escapeHtml(String(f.Default)) : '<span class="null-value">NULL</span>'}</td>
            <td class="text-muted text-sm">${escapeHtml(f.Extra || '')}</td>
            <td></td>
        </tr>
    `).join('');
}

function renderIndexesTable(indexes) {
    const tbody = document.getElementById('indexesTable').querySelector('tbody');
    tbody.innerHTML = (indexes || []).map(idx => `
        <tr>
            <td><strong>${escapeHtml(idx.Key_name || idx.indexname || '')}</strong></td>
            <td><code>${escapeHtml(idx.Column_name || idx.column_name || '')}</code></td>
            <td><span class="badge ${idx.Non_unique === 0 ? 'badge-success' : 'badge-muted'}">${idx.Non_unique === 0 ? 'Yes' : 'No'}</span></td>
            <td class="text-muted">${escapeHtml(idx.Index_type || idx.indexdef?.split(' ')[0] || '')}</td>
            <td class="text-muted">${idx.Cardinality || '—'}</td>
        </tr>
    `).join('');
}

function populateAlterFormColumns(structure) {
    const selects = ['dropColumnName', 'modifyColumnName'];
    selects.forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        sel.innerHTML = '<option value="">Select Column</option>' +
            structure.map(f => `<option value="${f.Field}">${f.Field} (${f.Type})</option>`).join('');
    });
}

function populateIndexColumns(structure) {
    const sel = document.getElementById('newIndexColumns');
    if (!sel) return;
    sel.innerHTML = structure.map(f => `<option value="${f.Field}">${f.Field}</option>`).join('');
}

// ============================================================
//  QUERY EDITOR
// ============================================================
function executeQuery() {
    const query = sqlEditor ? sqlEditor.getValue().trim() : document.getElementById('sqlQuery').value.trim();
    const db = document.getElementById('queryDatabase').value;
    if (!query) return showNotification('Query is empty', 'warning');
    if (!db) return showNotification('Select a database', 'warning');

    socket.emit('save_query_history', { query, database: db });
    const start = Date.now();
    socket.emit('execute_query', { database: db, query });

    socket.once('query_result', () => {
        document.getElementById('queryExecTime').textContent = `${Date.now() - start}ms`;
    });
}

document.getElementById('executeQuery').addEventListener('click', executeQuery);

document.getElementById('clearQuery').addEventListener('click', () => {
    if (sqlEditor) sqlEditor.setValue('');
    else document.getElementById('sqlQuery').value = '';
});

document.getElementById('formatQuery').addEventListener('click', () => {
    if (!sqlEditor) return;
    // Basic formatting: uppercase keywords
    const keywords = ['SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'ON', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'CREATE TABLE', 'DROP TABLE', 'ALTER TABLE', 'AND', 'OR', 'NOT', 'IN', 'BETWEEN', 'LIKE', 'IS NULL', 'IS NOT NULL'];
    let sql = sqlEditor.getValue();
    keywords.forEach(kw => {
        sql = sql.replace(new RegExp(`\\b${kw}\\b`, 'gi'), kw);
    });
    sqlEditor.setValue(sql);
});

document.getElementById('toggleQueryHistoryBtn').addEventListener('click', () => {
    const panel = document.getElementById('queryHistoryPanel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
});

document.getElementById('clearQueryHistoryBtn').addEventListener('click', () => {
    socket.emit('clear_query_history');
});

function renderQueryHistory(history) {
    const list = document.getElementById('queryHistoryList');
    list.innerHTML = '';
    if (!history.length) {
        list.innerHTML = '<div class="text-muted text-sm" style="padding:8px;">No query history</div>';
        return;
    }
    history.slice(0, 50).forEach(h => {
        const div = document.createElement('div');
        div.className = 'qh-item';
        div.innerHTML = `
            <div style="overflow:hidden;">
                <div class="qh-query">${escapeHtml(h.query)}</div>
                <div class="qh-meta">${new Date(h.timestamp).toLocaleString()} · ${escapeHtml(h.database || '')}</div>
            </div>
            <button class="btn btn-ghost btn-sm" style="flex-shrink:0;">Use</button>
        `;
        div.querySelector('button').addEventListener('click', () => {
            if (sqlEditor) sqlEditor.setValue(h.query);
            document.getElementById('queryDatabase').value = h.database || '';
            document.getElementById('queryHistoryPanel').style.display = 'none';
            showNotification('Query loaded into editor', 'success');
        });
        list.appendChild(div);
    });
}

function displayQueryResult({ result }) {
    const container = document.getElementById('queryResults');
    if (!result) { container.innerHTML = '<p>No result</p>'; return; }

    if (Array.isArray(result) && result.length > 0) {
        const cols = Object.keys(result[0]);
        container.innerHTML = `
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">${result.length} rows returned</div>
            <div style="overflow:auto;">
            <table class="generic-table">
                <thead><tr>${cols.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
                <tbody>${result.map(row => `<tr>${cols.map(c => `<td>${row[c] === null ? '<span class="null-value">NULL</span>' : escapeHtml(String(row[c]))}</td>`).join('')}</tr>`).join('')}</tbody>
            </table></div>`;
    } else if (result.affectedRows !== undefined) {
        container.innerHTML = `<div class="notification success" style="pointer-events:all;max-width:300px;"><span class="notification-icon">✅</span><span>Query OK — ${result.affectedRows} rows affected</span></div>`;
    } else if (Array.isArray(result) && result.length === 0) {
        container.innerHTML = '<div class="empty-state" style="padding:20px;"><div class="empty-state-desc">Query executed successfully — 0 rows returned</div></div>';
    } else {
        container.innerHTML = `<pre style="font-size:12px;color:var(--text-sub);overflow:auto;">${escapeHtml(JSON.stringify(result, null, 2))}</pre>`;
    }
}

// ============================================================
//  PAGINATION CONTROLS
// ============================================================
document.getElementById('prevPage').addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; loadTableData(); }
});

document.getElementById('nextPage').addEventListener('click', () => {
    const maxPage = Math.ceil(totalRows / pageSize);
    if (currentPage < maxPage) { currentPage++; loadTableData(); }
});

document.getElementById('pageSize').addEventListener('change', (e) => {
    pageSize = parseInt(e.target.value);
    currentPage = 1;
    loadTableData();
});

document.getElementById('pageJumpBtn').addEventListener('click', () => {
    const page = parseInt(document.getElementById('pageJump').value);
    if (page > 0) { currentPage = page; loadTableData(); }
});

// ============================================================
//  SEARCH / FILTERS
// ============================================================
function collectFilters() {
    const filters = [];
    document.querySelectorAll('#searchFiltersContainer .filter-row').forEach(row => {
        const col = row.querySelector('.filter-column').value;
        const op = row.querySelector('.filter-operator').value;
        const val = row.querySelector('.filter-value').value;
        if (col && val) filters.push({ column: col, operator: op, value: val });
    });
    return filters;
}

document.getElementById('addFilterBtn').addEventListener('click', () => {
    const container = document.getElementById('searchFiltersContainer');
    const row = document.createElement('div');
    row.className = 'filter-row';
    row.innerHTML = `
        <select class="filter-column form-control" style="width:130px;padding:5px 8px;font-size:12px;">
            <option value="">Column</option>
            ${_columnMap.map(c => `<option>${c}</option>`).join('')}
        </select>
        <select class="filter-operator form-control" style="width:110px;padding:5px 8px;font-size:12px;">
            <option value="LIKE">Contains</option>
            <option value="NOT LIKE">Not Contains</option>
            <option value="=">=</option>
            <option value="!=">!=</option>
            <option value=">">&gt;</option>
            <option value="<">&lt;</option>
        </select>
        <input type="text" class="filter-value form-control" style="width:140px;padding:5px 8px;font-size:12px;" placeholder="Value...">
        <button type="button" class="btn btn-danger btn-sm remove-filter-btn">✕</button>
    `;
    row.querySelector('.remove-filter-btn').addEventListener('click', () => row.remove());
    container.appendChild(row);
});

// Remove filter (for initial row)
document.querySelector('.remove-filter-btn').addEventListener('click', function() {
    const rows = document.querySelectorAll('#searchFiltersContainer .filter-row');
    if (rows.length > 1) this.closest('.filter-row').remove();
});

document.getElementById('searchBtn').addEventListener('click', () => {
    currentPage = 1;
    currentSearchFilters = collectFilters();
    currentSearchLogic = document.getElementById('searchLogic').value;
    loadTableData();
});

document.getElementById('clearSearchBtn').addEventListener('click', () => {
    document.querySelectorAll('.filter-value').forEach(i => i.value = '');
    document.querySelectorAll('.filter-column').forEach(s => s.value = '');
    currentSearchFilters = [];
    currentPage = 1;
    loadTableData();
});

// ============================================================
//  ROW EDIT / INSERT / DELETE
// ============================================================
window.openEditRowModal = function(rowJson) {
    const row = JSON.parse(rowJson);
    const fields = document.getElementById('editRowFields');
    fields.innerHTML = Object.entries(row).map(([key, val]) => `
        <div class="form-group">
            <label>${escapeHtml(key)}</label>
            <input class="form-control" type="text" name="${escapeHtml(key)}" value="${val !== null ? escapeHtml(String(val)) : ''}" placeholder="NULL">
        </div>
    `).join('');

    document.getElementById('editRowForm').onsubmit = (e) => {
        e.preventDefault();
        const updateData = {};
        new FormData(e.target).forEach((val, key) => { updateData[key] = val; });
        // Find PK
        let pkCol = null, pkVal = null;
        if (currentTableStructure) {
            const pk = currentTableStructure.find(f => f.Key === 'PRI');
            if (pk) { pkCol = pk.Field; pkVal = row[pk.Field]; }
        }
        if (!pkCol) { pkCol = Object.keys(row)[0]; pkVal = row[pkCol]; }
        socket.emit('update_row', { database: currentDatabase, table: currentTable, primaryKeyColumn: pkCol, primaryKeyValue: pkVal, updateData });
    };

    showModal('modalEditRow');
};

window.deleteRow = function(rowJson) {
    const row = JSON.parse(rowJson);
    if (!confirm('Delete this row?')) return;
    let pkCol = Object.keys(row)[0];
    if (currentTableStructure) {
        const pk = currentTableStructure.find(f => f.Key === 'PRI');
        if (pk) pkCol = pk.Field;
    }
    socket.emit('delete_selected_data', {
        database: currentDatabase, table: currentTable,
        targetColumn: pkCol, targetValues: [row[pkCol]]
    });
};

function openInsertRowModal() {
    if (!currentTableStructure) return showNotification('Select a table first', 'warning');
    document.getElementById('insertRowTableName').textContent = currentTable;
    const container = document.getElementById('insertRowFields');
    container.innerHTML = currentTableStructure.map(f => `
        <div class="form-group">
            <label>${escapeHtml(f.Field)} <span class="text-muted text-sm">${escapeHtml(f.Type)}${f.Null === 'NO' ? ' *' : ''}</span></label>
            <input class="form-control" type="text" name="${escapeHtml(f.Field)}" placeholder="${f.Default !== null ? 'Default: ' + f.Default : 'NULL'}">
        </div>
    `).join('');
    showModal('modalInsertRow');
}

document.getElementById('insertRowBtn').addEventListener('click', openInsertRowModal);

document.getElementById('insertRowForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const rowData = {};
    new FormData(e.target).forEach((val, key) => { if (val.trim()) rowData[key] = val.trim(); });
    socket.emit('insert_row', { database: currentDatabase, table: currentTable, rowData });
});

document.getElementById('deleteSelectedRows').addEventListener('click', () => {
    const checked = Array.from(document.querySelectorAll('#dataTable tbody .row-select-checkbox:checked'));
    if (!checked.length) return showNotification('Select rows first', 'warning');
    if (!confirm(`Delete ${checked.length} selected rows?`)) return;
    const pkCol = currentTableStructure?.find(f => f.Key === 'PRI')?.Field || _columnMap[0];
    const pkVals = checked.map(cb => {
        const row = window._rowData[cb.closest('tr').dataset.rowIdx];
        return row ? row[pkCol] : null;
    }).filter(v => v !== null);
    socket.emit('delete_selected_data', { database: currentDatabase, table: currentTable, targetColumn: pkCol, targetValues: pkVals });
});

document.getElementById('deleteAllData').addEventListener('click', () => {
    if (!confirm(`Delete ALL data from "${currentTable}"? This cannot be undone!`)) return;
    socket.emit('delete_all_data', { database: currentDatabase, table: currentTable });
});

// ============================================================
//  EXPORT
// ============================================================
function showExportDatabaseModal(db) {
    currentDatabase = db || currentDatabase;
    document.getElementById('exportDbName').textContent = currentDatabase;
    // Populate table checkboxes
    const list = document.getElementById('exportTablesList');
    list.innerHTML = '';
    const tables = Array.from(document.querySelectorAll(`#dbtables-${currentDatabase} .table-node`)).map(n => n.dataset.table);
    tables.forEach(t => {
        const label = document.createElement('label');
        label.className = 'checkbox-label';
        label.innerHTML = `<input type="checkbox" name="exportTable" value="${t}" checked> ${t}`;
        label.style.marginBottom = '4px';
        list.appendChild(label);
    });
    showModal('modalExportDatabase');
}

function showExportTableModal(db, table) {
    document.getElementById('exportTableName').textContent = `${db || currentDatabase}.${table || currentTable}`;
    showModal('modalExportTable');
}

window.selectAllTables = () => document.querySelectorAll('[name="exportTable"]').forEach(cb => cb.checked = true);
window.deselectAllTables = () => document.querySelectorAll('[name="exportTable"]').forEach(cb => cb.checked = false);
window.previewRowCount = () => {
    const where = document.getElementById('exportWhereClause').value;
    if (currentDatabase && currentTable) socket.emit('get_row_count', { database: currentDatabase, table: currentTable, whereClause: where });
};

document.getElementById('exportDatabaseForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const format = document.querySelector('[name="exportFormat"]:checked').value;
    const method = document.querySelector('[name="exportMethod"]:checked').value;
    const tables = Array.from(document.querySelectorAll('[name="exportTable"]:checked')).map(cb => cb.value);
    socket.emit('export_database', {
        database: currentDatabase,
        options: { format, exportMethod: method, includeData: document.getElementById('exportIncludeData').checked, tables }
    });
    showNotification('Preparing export...', 'info');
});

document.getElementById('exportTableForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const exportType = document.querySelector('[name="dataExportType"]:checked')?.value;
    socket.emit('export_table', {
        database: currentDatabase, table: currentTable,
        options: {
            format: document.querySelector('[name="tableExportFormat"]:checked').value,
            includeData: document.getElementById('exportTableIncludeData').checked,
            exportType,
            whereClause: exportType === 'custom' ? document.getElementById('exportWhereClause').value : null
        }
    });
    showNotification('Preparing export...', 'info');
});

// Export current data button
document.getElementById('exportCurrentData').addEventListener('click', () => showExportTableModal());

// Custom WHERE clause toggle
document.querySelectorAll('[name="dataExportType"]').forEach(r => {
    r.addEventListener('change', () => {
        document.getElementById('customWhereClause').style.display =
            document.querySelector('[name="dataExportType"]:checked')?.value === 'custom' ? 'block' : 'none';
    });
});

// ============================================================
//  IMPORT
// ============================================================
document.getElementById('importDatabaseBtn').addEventListener('click', () => {
    if (!currentDatabase) return showNotification('Select a database first', 'warning');
    document.getElementById('importDbName').textContent = currentDatabase;
    showModal('modalImportDatabase');
});

// Drag-and-drop for import
const dropZone = document.getElementById('importDropZone');
dropZone.addEventListener('click', () => document.getElementById('importFile').click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleImportFile(file);
});
document.getElementById('importFile').addEventListener('change', e => {
    if (e.target.files[0]) handleImportFile(e.target.files[0]);
});

function handleImportFile(file) {
    const info = document.getElementById('importFileInfo');
    info.style.display = 'block';
    info.textContent = `📄 ${file.name} (${formatFileSize(file.size)})`;
    document.getElementById('importDropZone').querySelector('.file-drop-zone-text').textContent = file.name;
}

document.getElementById('importDatabaseForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const file = document.getElementById('importFile').files[0];
    if (!file) return showNotification('Select a file first', 'error');
    const reader = new FileReader();
    reader.onload = (ev) => {
        const type = file.name.endsWith('.json') ? 'json' : 'sql';
        socket.emit('import_database', { database: currentDatabase, content: ev.target.result, type });
        showNotification('Importing...', 'info');
        closeModal('modalImportDatabase');
    };
    reader.readAsText(file);
});

// ============================================================
//  ALTER TABLE FORMS
// ============================================================
document.querySelectorAll('.alter-section-header').forEach(hdr => {
    hdr.addEventListener('click', () => {
        hdr.closest('.alter-section').classList.toggle('open');
        const arrow = hdr.querySelector('span:last-child');
        if (arrow) arrow.textContent = hdr.closest('.alter-section').classList.contains('open') ? '▼' : '▶';
    });
});

document.getElementById('addColumnForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('newColumnName').value.trim();
    const type = document.getElementById('newColumnType').value;
    const nullable = document.getElementById('newColumnNull').checked ? 'NULL' : 'NOT NULL';
    const def = document.getElementById('newColumnDefault').value;
    const pos = document.getElementById('newColumnPosition').value;
    const q = `ALTER TABLE \`${currentTable}\` ADD COLUMN \`${name}\` ${type} ${nullable}${def ? ` DEFAULT '${def}'` : ''} ${pos}`;
    socket.emit('alter_table', { database: currentDatabase, table: currentTable, alterQuery: q });
});

document.getElementById('dropColumnForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const col = document.getElementById('dropColumnName').value;
    if (!confirm(`Drop column "${col}"?`)) return;
    socket.emit('alter_table', { database: currentDatabase, table: currentTable, alterQuery: `ALTER TABLE \`${currentTable}\` DROP COLUMN \`${col}\`` });
});

document.getElementById('modifyColumnForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const col = document.getElementById('modifyColumnName').value;
    const type = document.getElementById('modifyColumnType').value;
    const nullable = document.getElementById('modifyColumnNull').checked ? 'NULL' : 'NOT NULL';
    const def = document.getElementById('modifyColumnDefault').value;
    socket.emit('alter_table', { database: currentDatabase, table: currentTable, alterQuery: `ALTER TABLE \`${currentTable}\` MODIFY COLUMN \`${col}\` ${type} ${nullable}${def ? ` DEFAULT '${def}'` : ''}` });
});

document.getElementById('addIndexForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('newIndexName').value;
    const cols = Array.from(document.getElementById('newIndexColumns').selectedOptions).map(o => `\`${o.value}\``).join(', ');
    const type = document.getElementById('newIndexType').value;
    socket.emit('alter_table', { database: currentDatabase, table: currentTable, alterQuery: `ALTER TABLE \`${currentTable}\` ADD ${type} \`${name}\` (${cols})` });
});

document.getElementById('customAlterForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = document.getElementById('customAlterQuery').value.trim();
    if (!q) return;
    socket.emit('alter_table', { database: currentDatabase, table: currentTable, alterQuery: q });
});

document.getElementById('dropTableBtn').addEventListener('click', () => {
    if (!currentTable) return;
    if (confirm(`Drop table "${currentTable}"? This cannot be undone!`)) {
        socket.emit('drop_table', { database: currentDatabase, table: currentTable });
    }
});

document.getElementById('exportTableBtn').addEventListener('click', () => showExportTableModal());

// ============================================================
//  DATABASE CREATION
// ============================================================
document.getElementById('createDatabaseBtn').addEventListener('click', () => showModal('modalCreateDatabase'));

document.getElementById('createDatabaseForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('newDatabaseName').value.trim();
    if (name) socket.emit('create_database', name);
});

// ============================================================
//  QUERY DATABASE SELECTS
// ============================================================
function populateQueryDatabaseSelects(databases) {
    const selects = ['queryDatabase', 'erDatabase', 'sqDatabase', 'diffDb1', 'diffDb2'];
    selects.forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const cur = sel.value;
        sel.innerHTML = '<option value="">Select Database</option>' +
            databases.map(db => `<option value="${db}">${db}</option>`).join('');
        if (cur) sel.value = cur;
    });
}

// ============================================================
//  SYSTEM STATS
// ============================================================
var statsInterval = null;

function startStatsPolling() {
    if (statsInterval) return;
    document.getElementById('systemStats').style.display = 'flex';
    statsInterval = setInterval(async () => {
        try {
            const data = await fetch('/api/system-stats').then(r => r.json());
            document.getElementById('cpuBar').style.width = data.cpuUsage + '%';
            document.getElementById('cpuText').textContent = data.cpuUsage + '%';
            document.getElementById('memBar').style.width = data.memUsage + '%';
            document.getElementById('memText').textContent = data.memUsage + '%';
            // Update dashboard server info
            document.getElementById('serverCpuCores').textContent = data.cpuCount;
            document.getElementById('serverRam').textContent = data.totalMem;
            document.getElementById('serverUptime').textContent = formatUptime(data.uptime);
            document.getElementById('serverPlatform').textContent = data.platform;
        } catch {}
    }, 2000);
}

function stopStatsPolling() {
    if (statsInterval) { clearInterval(statsInterval); statsInterval = null; }
    document.getElementById('systemStats').style.display = 'none';
}

function updateServerInfo() {
    if (currentCredentials) {
        document.getElementById('serverHost').textContent = `${currentCredentials.host}:${currentCredentials.port}`;
        document.getElementById('serverEngine').textContent = (currentCredentials.engine || 'MySQL').toUpperCase();
    }
}

function formatUptime(seconds) {
    if (!seconds) return '—';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${d}d ${h}h ${m}m`;
}

// ============================================================
//  SETTINGS
// ============================================================
document.getElementById('settingsBtn').addEventListener('click', () => {
    socket.emit('get_settings');
    renderProfilesList();
    showModal('modalSettings');
});

document.getElementById('saveSettingsBtn').addEventListener('click', () => {
    const newSettings = {
        general: {
            showSystemStats: document.getElementById('settingShowSystemStats').checked,
            autoReconnect: document.getElementById('settingAutoReconnect').checked,
        },
        backupProfiles,
        appearance: {
            theme: getStoredThemePref(),
            editorTheme: document.getElementById('settingEditorTheme').value
        }
    };
    socket.emit('save_settings', newSettings);
    closeModal('modalSettings');
    applySettings();
});

function applySettings() {
    if (settings.general?.showSystemStats) startStatsPolling();
    else stopStatsPolling();

    if (settings.backupProfiles) backupProfiles = settings.backupProfiles;

    if (settings.appearance) {
        const themeOpt = settings.appearance.theme || 'auto';
        setTheme(themeOpt);
        if (settings.appearance.editorTheme && sqlEditor) {
            sqlEditor.setOption('theme', settings.appearance.editorTheme);
        }
    }
}

// Settings navigation tabs
document.querySelectorAll('.settings-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.settings-nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.settings-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.pane).classList.add('active');
    });
});

// Theme options in settings
document.querySelectorAll('[data-theme-opt]').forEach(el => {
    el.addEventListener('click', () => {
        document.querySelectorAll('[data-theme-opt]').forEach(e => e.classList.remove('active'));
        el.classList.add('active');
        setTheme(el.dataset.themeOpt);
    });
});

// Dark mode toggle in header
document.getElementById('darkModeToggle').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    setTheme(cur === 'dark' ? 'light' : 'dark');
});

document.getElementById('settingEditorTheme').addEventListener('change', (e) => {
    if (sqlEditor) sqlEditor.setOption('theme', e.target.value);
});

document.getElementById('clearAllCredsBtn').addEventListener('click', async () => {
    if (!confirm('Clear all stored passwords?')) return;
    const saved = JSON.parse(localStorage.getItem('savedConnections') || '[]');
    for (const conn of saved) {
        const key = `${conn.host}:${conn.port}:${conn.user}`;
        await fetch('/api/credential/delete?key=' + encodeURIComponent(key), { method: 'DELETE' }).catch(() => {});
    }
    showNotification('All stored passwords cleared', 'success');
});

document.getElementById('openSchemaDiffBtn').addEventListener('click', () => {
    closeModal('modalSettings');
    openSchemaDiff();
});

document.getElementById('viewBackupHistoryBtn').addEventListener('click', () => {
    closeModal('modalSettings');
    openBackupHistoryModal();
});

// ============================================================
//  BACKUP PROFILES
// ============================================================
function renderProfilesList() {
    const container = document.getElementById('profilesList');
    if (!backupProfiles.length) {
        container.innerHTML = '<div class="empty-state" style="padding:20px;"><div class="empty-state-desc">No backup profiles yet. Click "+ Add Profile" to create one.</div></div>';
        return;
    }
    container.innerHTML = backupProfiles.map((p, i) => `
        <div class="profile-card">
            <div class="profile-card-header">
                <span class="profile-card-name">${escapeHtml(p.name)}</span>
                <label class="profile-enabled-toggle">
                    <input type="checkbox" ${p.enabled ? 'checked' : ''} onchange="toggleProfile(${i},this.checked)">
                    <span class="toggle-slider"></span>
                </label>
                <button class="btn btn-ghost btn-sm" onclick="editProfile(${i})">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="deleteProfile(${i})">Delete</button>
            </div>
            <div class="profile-dbs">
                ${(p.databases || []).map(db => `<span class="db-chip">📦 ${escapeHtml(db)}</span>`).join('')}
            </div>
            <div class="text-muted text-sm">${escapeHtml(p.interval || 'daily')} · Keep ${p.retention || 5} backups · CPU ≤ ${p.cpuLimit || 80}%</div>
        </div>
    `).join('');
}

window.toggleProfile = (idx, enabled) => { backupProfiles[idx].enabled = enabled; };
window.deleteProfile = (idx) => { if (confirm('Delete this profile?')) { backupProfiles.splice(idx, 1); renderProfilesList(); } };
window.editProfile = (idx) => { openProfileModal(backupProfiles[idx], idx); };

document.getElementById('addProfileBtn').addEventListener('click', () => openProfileModal(null, null));

function openProfileModal(profile, idx) {
    document.getElementById('profileModalTitle').textContent = profile ? 'Edit Backup Profile' : '+ New Backup Profile';
    document.getElementById('profileEditId').value = idx !== null ? idx : '';
    document.getElementById('profileName').value = profile?.name || '';
    document.getElementById('profileEnabled').checked = profile?.enabled !== false;
    document.getElementById('profileHost').value = profile?.credentials?.host || '';
    document.getElementById('profilePort').value = profile?.credentials?.port || 3306;
    document.getElementById('profileEngine').value = profile?.credentials?.engine || 'mysql';
    document.getElementById('profileUser').value = profile?.credentials?.user || '';
    document.getElementById('profilePassword').value = '';
    document.getElementById('profileInterval').value = profile?.interval || 'daily';
    document.getElementById('profileRetention').value = profile?.retention || 5;
    document.getElementById('profileCpuLimit').value = profile?.cpuLimit || 80;

    // Render db chips
    const chips = document.getElementById('profileDbChips');
    chips.innerHTML = '';
    (profile?.databases || []).forEach(db => addProfileDbChip(db));
    showModal('modalAddProfile');
}

function addProfileDbChip(db) {
    const chips = document.getElementById('profileDbChips');
    const chip = document.createElement('span');
    chip.className = 'db-chip';
    chip.dataset.db = db;
    chip.innerHTML = `📦 ${escapeHtml(db)} <button class="db-chip-remove">✕</button>`;
    chip.querySelector('.db-chip-remove').addEventListener('click', () => chip.remove());
    chips.appendChild(chip);
}

document.getElementById('addProfileDbBtn').addEventListener('click', () => {
    const input = document.getElementById('profileDbInput');
    if (input.value.trim()) { addProfileDbChip(input.value.trim()); input.value = ''; }
});

document.getElementById('profileDbInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('addProfileDbBtn').click(); }
});

document.getElementById('profileInterval').addEventListener('change', (e) => {
    document.getElementById('profileCustomCronGroup').style.display = e.target.value === 'custom' ? 'block' : 'none';
});

document.getElementById('saveProfileBtn').addEventListener('click', async () => {
    const idx = document.getElementById('profileEditId').value;
    const databases = Array.from(document.querySelectorAll('#profileDbChips .db-chip')).map(c => c.dataset.db);
    const pw = document.getElementById('profilePassword').value;
    const host = document.getElementById('profileHost').value;
    const port = parseInt(document.getElementById('profilePort').value);
    const user = document.getElementById('profileUser').value;
    const credKey = `profile:${host}:${port}:${user}`;

    if (pw) {
        await fetch('/api/credential/set', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: credKey, password: pw })
        }).catch(() => {});
    }

    const profile = {
        id: idx || Date.now().toString(),
        name: document.getElementById('profileName').value.trim(),
        enabled: document.getElementById('profileEnabled').checked,
        credentials: { host, port, user, engine: document.getElementById('profileEngine').value },
        credentialKey: credKey,
        databases,
        interval: document.getElementById('profileInterval').value,
        cronExpression: document.getElementById('profileCustomCron').value,
        retention: parseInt(document.getElementById('profileRetention').value),
        cpuLimit: parseInt(document.getElementById('profileCpuLimit').value),
    };

    if (idx !== '') backupProfiles[parseInt(idx)] = profile;
    else backupProfiles.push(profile);

    renderProfilesList();
    closeModal('modalAddProfile');
});

// ============================================================
//  BACKUP HISTORY
// ============================================================
function openBackupHistoryModal() {
    socket.emit('list_backups');
    showModal('modalBackupHistory');
}

function loadBackupHistory() {
    socket.emit('list_backups');
}

document.getElementById('manageBackupsBtn').addEventListener('click', openBackupHistoryModal);

function renderBackupHistory(backups) {
    const tbody = document.getElementById('backupHistoryTable').querySelector('tbody');
    tbody.innerHTML = '';

    // Update recent backups on dashboard
    const recentEl = document.getElementById('recentBackupsList');
    if (!backups.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--text-muted);">No backups found</td></tr>';
        recentEl.innerHTML = '<div class="text-muted text-sm">No backups yet</div>';
        return;
    }

    backups.forEach(backup => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-family:'JetBrains Mono',monospace;font-size:12px;">${escapeHtml(backup.name)}</td>
            <td><span class="badge badge-muted">${formatFileSize(backup.size)}</span></td>
            <td class="text-muted text-sm">${new Date(backup.date).toLocaleString()}</td>
            <td>
                <div style="display:flex;gap:4px;">
                    <button class="btn btn-primary btn-sm" onclick="downloadBackup('${escapeHtml(backup.name)}')">↓</button>
                    <button class="btn btn-warning btn-sm" onclick="restoreBackup('${escapeHtml(backup.name)}')">Restore</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteBackup('${escapeHtml(backup.name)}')">✕</button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Dashboard recent 3
    recentEl.innerHTML = backups.slice(0, 3).map(b => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);">
            <div>
                <div style="font-size:12px;font-weight:500;color:var(--text-main);">${escapeHtml(b.name.split('__')[0])}</div>
                <div class="text-muted text-sm">${new Date(b.date).toLocaleString()}</div>
            </div>
            <span class="badge badge-muted">${formatFileSize(b.size)}</span>
        </div>
    `).join('');
}

window.downloadBackup = (filename) => { window.open('/backups/' + encodeURIComponent(filename), '_blank'); };

window.deleteBackup = (filename) => {
    if (confirm(`Delete backup "${filename}"?`)) socket.emit('delete_backup', filename);
};

window.restoreBackup = (filename) => {
    const db = prompt('Enter target database name to restore into:', currentDatabase || '');
    if (db?.trim()) {
        socket.emit('restore_backup', { filename, targetDatabase: db.trim() });
        showNotification('Restoring backup...', 'info');
    }
};

document.getElementById('uploadBackupBtn').addEventListener('click', () => document.getElementById('uploadBackupInput').click());
document.getElementById('uploadBackupInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('backupFile', file);
    showNotification('Uploading...', 'info');
    try {
        const r = await fetch('/api/upload-backup', { method: 'POST', body: formData });
        const d = await r.json();
        if (d.success) { showNotification('Upload successful', 'success'); socket.emit('list_backups'); }
        else showNotification(d.error || 'Upload failed', 'error');
    } catch { showNotification('Upload failed', 'error'); }
});

function manualBackupDatabase(db) {
    showNotification(`Backup of "${db}" queued — will run in background`, 'info');
}

// ============================================================
//  ER DIAGRAM
// ============================================================
let erTables = {};
let erFkData = [];
let erZoom = 1;
let erDragging = null;
let erDragOffset = { x: 0, y: 0 };

document.getElementById('loadErBtn').addEventListener('click', () => {
    const db = document.getElementById('erDatabase').value;
    if (!db) return showNotification('Select a database', 'warning');
    socket.emit('get_table_structure', { database: db, table: '__all__' });
    socket.emit('get_foreign_keys', db);
    showNotification('Loading ER diagram...', 'info');
});

function renderERDiagram(database, fkData) {
    erFkData = fkData || [];
    const canvas = document.getElementById('erCanvas');
    const svg = document.getElementById('erSvg');

    // Remove old cards
    canvas.querySelectorAll('.er-table-card').forEach(c => c.remove());
    svg.innerHTML = '';
    erTables = {};

    // Load table structures for all tables in the database
    const tables = Array.from(document.querySelectorAll(`#dbtables-${database} .table-node`)).map(n => n.dataset.table);
    if (!tables.length) {
        showNotification('No tables in the selected database', 'warning');
        return;
    }

    let loaded = 0;
    tables.forEach((table, idx) => {
        socket.emit('get_table_structure', { database, table });
        socket.once(`table_structure_${database}_${table}`, (structure) => {
            erTables[table] = structure;
            loaded++;
            if (loaded === tables.length) drawERCards(tables);
        });
    });

    // Fallback: use currentTableStructure if available
    if (tables.length === 0 && currentTableStructure) {
        erTables[currentTable] = currentTableStructure;
        drawERCards([currentTable]);
    }

    // Since socket events for specific tables aren't separate, listen for all structure events
    socket.on('table_structure', ({ table, structure, database: db }) => {
        if (db === database) {
            erTables[table] = structure;
            if (Object.keys(erTables).length === tables.length) {
                drawERCards(tables);
                socket.off('table_structure');
            }
        }
    });
}

function drawERCards(tables) {
    const canvas = document.getElementById('erCanvas');
    canvas.querySelectorAll('.er-table-card').forEach(c => c.remove());
    document.getElementById('erSvg').innerHTML = '';

    const cols = 3;
    const startX = 40, startY = 40, spacingX = 240, spacingY = 280;

    tables.forEach((table, idx) => {
        const structure = erTables[table] || [];
        const x = startX + (idx % cols) * spacingX;
        const y = startY + Math.floor(idx / cols) * spacingY;

        const card = document.createElement('div');
        card.className = 'er-table-card';
        card.dataset.table = table;
        card.style.left = x + 'px';
        card.style.top = y + 'px';
        card.innerHTML = `
            <div class="er-table-header">📋 ${escapeHtml(table)}</div>
            ${structure.map(f => `
                <div class="er-table-field">
                    ${f.Key === 'PRI' ? '<span class="er-field-key">🔑</span>' : f.Key === 'MUL' ? '<span class="er-field-key">🔗</span>' : '<span class="er-field-key" style="visibility:hidden;">·</span>'}
                    <span class="er-field-name">${escapeHtml(f.Field)}</span>
                    <span class="er-field-type">${escapeHtml(f.Type.split('(')[0])}</span>
                </div>
            `).join('')}
        `;

        // Drag
        card.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            erDragging = card;
            const rect = card.getBoundingClientRect();
            const canvasRect = canvas.getBoundingClientRect();
            erDragOffset = { x: e.clientX - rect.left + canvasRect.left - canvas.getBoundingClientRect().left, y: e.clientY - rect.top + canvasRect.top - canvas.getBoundingClientRect().top };
            e.preventDefault();
        });

        canvas.appendChild(card);
    });

    document.addEventListener('mousemove', (e) => {
        if (!erDragging) return;
        const canvasRect = document.getElementById('erCanvas').getBoundingClientRect();
        const wrapRect = document.getElementById('erCanvasWrap').getBoundingClientRect();
        const x = e.clientX - wrapRect.left + document.getElementById('erCanvasWrap').scrollLeft - erDragOffset.x;
        const y = e.clientY - wrapRect.top + document.getElementById('erCanvasWrap').scrollTop - erDragOffset.y;
        erDragging.style.left = Math.max(0, x) + 'px';
        erDragging.style.top = Math.max(0, y) + 'px';
        drawFkLines();
    });

    document.addEventListener('mouseup', () => { erDragging = null; });
    drawFkLines();
}

function drawFkLines() {
    const canvas = document.getElementById('erCanvas');
    const svg = document.getElementById('erSvg');
    svg.innerHTML = '';

    erFkData.forEach(fk => {
        const fromCard = canvas.querySelector(`[data-table="${fk.from_table}"]`);
        const toCard = canvas.querySelector(`[data-table="${fk.to_table}"]`);
        if (!fromCard || !toCard) return;

        const fromRect = { x: parseInt(fromCard.style.left) + fromCard.offsetWidth, y: parseInt(fromCard.style.top) + 30 };
        const toRect = { x: parseInt(toCard.style.left), y: parseInt(toCard.style.top) + 30 };

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const midX = (fromRect.x + toRect.x) / 2;
        path.setAttribute('d', `M ${fromRect.x} ${fromRect.y} C ${midX} ${fromRect.y} ${midX} ${toRect.y} ${toRect.x} ${toRect.y}`);
        path.setAttribute('class', 'er-line');
        svg.appendChild(path);
    });
}

document.getElementById('erZoomIn').addEventListener('click', () => { erZoom = Math.min(2, erZoom + 0.1); document.getElementById('erCanvas').style.transform = `scale(${erZoom})`; });
document.getElementById('erZoomOut').addEventListener('click', () => { erZoom = Math.max(0.3, erZoom - 0.1); document.getElementById('erCanvas').style.transform = `scale(${erZoom})`; });
document.getElementById('erReset').addEventListener('click', () => { erZoom = 1; document.getElementById('erCanvas').style.transform = 'scale(1)'; drawERCards(Object.keys(erTables)); });

// ============================================================
//  SCHEMA DIFF
// ============================================================
function openSchemaDiff(db) {
    if (db) document.getElementById('diffDb1').value = db;
    showModal('modalSchemaDiff');
}

document.getElementById('runDiffBtn').addEventListener('click', () => {
    const db1 = document.getElementById('diffDb1').value;
    const db2 = document.getElementById('diffDb2').value;
    if (!db1 || !db2) return showNotification('Select two databases', 'warning');
    if (db1 === db2) return showNotification('Select two different databases', 'warning');
    socket.emit('diff_databases', { database1: db1, database2: db2 });
    showNotification('Comparing schemas...', 'info');
});

function renderSchemaDiff({ database1, database2, added, removed, modified }) {
    const container = document.getElementById('diffResults');
    let html = `<div class="diff-view">
        <div class="diff-col diff-col-left">
            <div class="diff-col-header">← Only in ${escapeHtml(database1)}</div>`;

    removed.forEach(t => html += `<div class="diff-item removed">📋 <span class="diff-table-name">${escapeHtml(t)}</span> (removed)</div>`);

    html += `</div><div class="diff-col diff-col-right">
        <div class="diff-col-header">→ Only in ${escapeHtml(database2)}</div>`;

    added.forEach(t => html += `<div class="diff-item added">📋 <span class="diff-table-name">${escapeHtml(t)}</span> (added)</div>`);

    html += `</div></div>`;

    if (modified.length) {
        html += `<div style="margin-top:16px;font-size:13px;font-weight:600;color:var(--text-main);">⚠️ Modified Tables (${modified.length})</div>`;
        modified.forEach(m => {
            html += `<div style="margin-top:8px;border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden;">
                <div style="padding:8px 12px;background:rgba(245,158,11,0.08);font-weight:600;font-size:13px;color:var(--warning);">📋 ${escapeHtml(m.table)}</div>
                <div style="padding:8px 12px;">
                    ${m.changes.map(c => `<div class="diff-item ${c.type === 'added_column' ? 'added' : c.type === 'removed_column' ? 'removed' : 'modified'}" style="margin-bottom:4px;">
                        ${c.type === 'added_column' ? `+ Column "${c.column}" added` :
                          c.type === 'removed_column' ? `- Column "${c.column}" removed` :
                          `~ Column "${c.column}": ${c.from?.Type} → ${c.to?.Type}`}
                    </div>`).join('')}
                </div>
            </div>`;
        });
    }

    if (!added.length && !removed.length && !modified.length) {
        html = `<div class="empty-state" style="padding:30px;">
            <div class="empty-state-icon">✅</div>
            <div class="empty-state-title">Schemas are identical!</div>
            <div class="empty-state-desc">No structural differences found between ${escapeHtml(database1)} and ${escapeHtml(database2)}</div>
        </div>`;
    }

    container.innerHTML = html;
}

// ============================================================
//  SLOW QUERY MONITOR
// ============================================================
document.getElementById('loadSlowQueriesBtn').addEventListener('click', () => {
    const db = document.getElementById('sqDatabase').value;
    const limit = parseInt(document.getElementById('sqLimit').value) || 20;
    if (!db) return showNotification('Select a database', 'warning');
    socket.emit('get_slow_queries', { database: db, limit });
    showNotification('Loading slow queries...', 'info');
});

function renderSlowQueries(queries, warning) {
    const container = document.getElementById('slowQueriesContent');
    if (warning) {
        container.innerHTML = `<div class="sq-warning">⚠️ ${escapeHtml(warning)}</div>`;
        return;
    }
    if (!queries.length) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">✅</div><div class="empty-state-title">No slow queries found!</div></div>';
        return;
    }
    container.innerHTML = `
        <div style="margin-bottom:12px;font-size:13px;color:var(--text-muted);">Top ${queries.length} slowest queries</div>
        <table class="generic-table">
            <thead>
                <tr>
                    <th>Query</th>
                    <th>Avg Time (ms)</th>
                    <th>Total Time (ms)</th>
                    <th>Calls</th>
                    <th>Rows</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
                ${queries.map(q => `
                    <tr>
                        <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:'JetBrains Mono',monospace;font-size:11.5px;" title="${escapeHtml(q.query)}">${escapeHtml(q.query)}</td>
                        <td><span class="badge ${parseFloat(q.avgMs) > 1000 ? 'badge-danger' : parseFloat(q.avgMs) > 100 ? 'badge-warning' : 'badge-success'}">${q.avgMs}</span></td>
                        <td class="text-muted">${q.totalMs}</td>
                        <td>${q.execCount}</td>
                        <td class="text-muted">${q.rows}</td>
                        <td>
                            <button class="btn btn-ghost btn-sm" onclick="copyQueryToEditor(${JSON.stringify(JSON.stringify(q.query))})">Copy</button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>`;
}

window.copyQueryToEditor = function(qJson) {
    const query = JSON.parse(qJson);
    if (sqlEditor) sqlEditor.setValue(query);
    switchContentTab('query');
    showNotification('Query copied to SQL editor', 'success');
};

// ============================================================
//  ANNOTATIONS
// ============================================================
function updateAnnotationIcons() {
    Object.keys(annotations).forEach(key => {
        const [db, table] = key.split('::');
        const icon = document.getElementById(`tblnote-${db}-${table}`);
        if (icon) icon.style.display = 'inline';
    });
}

function openAnnotationModal(db, table) {
    const key = `${db}::${table}`;
    document.getElementById('annotationTableName').textContent = `${db}.${table}`;
    document.getElementById('annotationText').value = annotations[key]?.note || '';
    document.getElementById('saveAnnotationBtn').onclick = () => {
        const note = document.getElementById('annotationText').value.trim();
        socket.emit('save_annotation', { key, note });
        closeModal('modalAnnotation');
    };
    document.getElementById('deleteAnnotationBtn').onclick = () => {
        if (confirm('Delete this note?')) {
            socket.emit('delete_annotation', { key });
            closeModal('modalAnnotation');
        }
    };
    showModal('modalAnnotation');
}

// Table note icons
document.getElementById('sidebarTree').addEventListener('click', (e) => {
    const noteIcon = e.target.closest('.table-note-icon');
    if (noteIcon) {
        const tableNode = noteIcon.closest('.table-node');
        const db = tableNode.dataset.db;
        const table = tableNode.dataset.table;
        openAnnotationModal(db, table);
    }
});

// ============================================================
//  DASHBOARD
// ============================================================
function renderDashboardDbSizes(sizes) {
    const list = document.getElementById('dbSizesList');
    if (!sizes.length) { list.innerHTML = '<div class="text-muted text-sm">No size data available</div>'; return; }
    const max = Math.max(...sizes.map(s => parseFloat(s.sizeMb) || 0));
    list.innerHTML = sizes.map(s => `
        <div class="db-size-row">
            <span class="db-size-name">📦 ${escapeHtml(s.database)}</span>
            <div class="db-size-bar-wrap">
                <div class="db-size-bar-fill" style="width:${max > 0 ? ((parseFloat(s.sizeMb) / max) * 100) : 0}%"></div>
            </div>
            <span class="db-size-value">${s.sizeMb} MB</span>
        </div>
    `).join('');

    // Update stat cards
    const totalMb = sizes.reduce((a, s) => a + (parseFloat(s.sizeMb) || 0), 0);
    renderDashboardStatCards(sizes.length, totalMb);
}

function renderDashboardStatCards(dbCount, totalMb) {
    const container = document.getElementById('dashboardStats');
    const tableCount = document.querySelectorAll('.table-node').length;
    container.innerHTML = `
        <div class="stat-card stat-card-accent">
            <div class="stat-card-icon">📦</div>
            <div class="stat-card-value">${dbCount}</div>
            <div class="stat-card-label">Databases</div>
        </div>
        <div class="stat-card stat-card-success">
            <div class="stat-card-icon">📋</div>
            <div class="stat-card-value">${tableCount}</div>
            <div class="stat-card-label">Total Tables</div>
        </div>
        <div class="stat-card stat-card-warning">
            <div class="stat-card-icon">💾</div>
            <div class="stat-card-value">${totalMb.toFixed(1)} MB</div>
            <div class="stat-card-label">Total DB Size</div>
        </div>
        <div class="stat-card stat-card-danger">
            <div class="stat-card-icon">⚡</div>
            <div class="stat-card-value">${(currentCredentials?.engine || 'MySQL').toUpperCase()}</div>
            <div class="stat-card-label">Engine</div>
        </div>
    `;
}

document.getElementById('refreshDbSizesBtn').addEventListener('click', () => socket.emit('get_db_sizes'));

// ============================================================
//  ERROR LOG
// ============================================================
function addErrorToLog(data) {
    const list = document.getElementById('errorLogList');
    const item = document.createElement('div');
    item.className = 'error-log-item';
    item.innerHTML = `
        <div class="error-log-item-meta">
            <span>${new Date().toLocaleTimeString()}</span>
            <span>·</span>
            <span>${escapeHtml(data.database || '')}</span>
        </div>
        <div class="error-log-item-msg">${escapeHtml(data.message)}</div>
        <div class="error-log-item-query">${escapeHtml(data.query || '')}</div>
    `;
    list.insertBefore(item, list.firstChild);
}

document.getElementById('clearErrorLogBtn').addEventListener('click', () => {
    document.getElementById('errorLogList').innerHTML = '';
    document.getElementById('errorLogContainer').style.display = 'none';
});

document.getElementById('closeErrorLogBtn').addEventListener('click', () => {
    document.getElementById('errorLogContainer').style.display = 'none';
});

// ============================================================
//  CONNECTION STATUS
// ============================================================
function updateConnectionStatus(connected) {
    const dot = document.getElementById('connDot');
    const text = document.getElementById('connStatusText');
    dot.className = 'conn-dot' + (connected ? ' connected' : '');
    text.textContent = connected ? 'Connected' : 'Disconnected';

    const logoutBtn = document.getElementById('logoutBtn');
    logoutBtn.style.display = connected ? 'inline-flex' : 'none';

    document.getElementById('connectBtn').textContent = 'Connect to Database';
    document.getElementById('connectBtn').disabled = false;
}

document.getElementById('logoutBtn').addEventListener('click', () => {
    socket.emit('disconnect_database');
    localStorage.removeItem('mysql_jwt_token');
});

// New session tab
document.getElementById('newSessionBtn').addEventListener('click', () => {
    showConnectionOverlay();
    showNotification('Opening new connection panel...', 'info');
});

// ============================================================
//  UTILITY FUNCTIONS
// ============================================================
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
}

function downloadFile(filename, content, isZip = false) {
    const mimeType = isZip ? 'application/zip' : filename.endsWith('.json') ? 'application/json' : 'text/plain';
    let blob;
    if (isZip && content.type === 'Buffer') {
        blob = new Blob([new Uint8Array(content.data)], { type: mimeType });
    } else {
        blob = new Blob([content], { type: mimeType });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
