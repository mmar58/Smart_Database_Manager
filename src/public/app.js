// Initialize Socket.IO connection
const socket = io();

// Global variables
let currentDatabase = null;
let currentTable = null;
let currentTableStructure = null;
let currentPrimaryKey = null;
let currentPage = 1;
let totalPages = 1;
let pageSize = 100;
let isConnected = false;
let currentSortColumn = null;
let currentSortDirection = 'ASC';
let currentSearchFilters = [];
let currentSearchLogic = 'AND';
let cachedColumns = [];
let currentCredentials = null;

// DOM Elements
const connectionForm = document.getElementById('connectionForm');
const connectionPanel = document.getElementById('connectionPanel');
const mainInterface = document.getElementById('mainInterface');
const connectionStatus = document.getElementById('connectionStatus');
const disconnectBtn = document.getElementById('disconnectBtn');
const logoutBtn = document.getElementById('logoutBtn');
const databaseList = document.getElementById('databaseList');
const tableList = document.getElementById('tableList');
const dataTable = document.getElementById('dataTable');
const structureTable = document.getElementById('structureTable');
const indexesTable = document.getElementById('indexesTable');
const selectedTableSpan = document.getElementById('selectedTable');
const pageInfo = document.getElementById('pageInfo');
const sqlQuery = document.getElementById('sqlQuery');
const queryResults = document.getElementById('queryResults');
const queryDatabase = document.getElementById('queryDatabase');

// Initialize the application
document.addEventListener('DOMContentLoaded', function () {
    // Restore engine selection from localStorage
    const savedEngine = localStorage.getItem('db_engine') || 'mysql';
    const engineSelect = document.getElementById('engine');
    engineSelect.value = savedEngine;

    setupEventListeners();
    setupSocketListeners();
    restoreSessionCredentials();
    loadSavedConnections();
});

function setupEventListeners() {
    // Connection form
    connectionForm.addEventListener('submit', handleConnection);
    disconnectBtn.addEventListener('click', handleDisconnection);
    logoutBtn.addEventListener('click', handleLogout);

    // Advanced options toggle
    document.getElementById('advancedOptionsToggle').addEventListener('click', function () {
        const advancedOptions = document.getElementById('advancedOptions');
        const icon = this.querySelector('.toggle-icon');
        if (advancedOptions.style.display === 'none') {
            advancedOptions.style.display = 'block';
            icon.textContent = '▲';
        } else {
            advancedOptions.style.display = 'none';
            icon.textContent = '▼';
        }
    });

    // Engine selection — save to localStorage and update default port
    document.getElementById('engine').addEventListener('change', function () {
        const engine = this.value;
        localStorage.setItem('db_engine', engine);
        const portEl = document.getElementById('port');
        if (engine === 'postgresql' && portEl.value === '3306') {
            portEl.value = '5432';
        } else if (engine === 'mysql' && portEl.value === '5432') {
            portEl.value = '3306';
        }
    });

    // Database operations
    document.getElementById('refreshDatabases').addEventListener('click', loadDatabases);
    document.getElementById('createDatabase').addEventListener('click', showCreateDatabaseModal);
    document.getElementById('refreshTables').addEventListener('click', loadTables);

    // Pagination
    document.getElementById('prevPage').addEventListener('click', () => changePage(-1));
    document.getElementById('nextPage').addEventListener('click', () => changePage(1));
    document.getElementById('pageSize').addEventListener('change', changePageSize);

    // Page jump
    document.getElementById('pageJumpBtn').addEventListener('click', jumpToPage);
    document.getElementById('pageJump').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') jumpToPage();
    });

    // Search functionality
    document.getElementById('searchBtn').addEventListener('click', performSearch);
    document.getElementById('clearSearchBtn').addEventListener('click', clearSearch);
    document.getElementById('addFilterBtn').addEventListener('click', addSearchFilterRow);

    // Search tips toggle
    document.getElementById('searchTipsBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        const popover = document.getElementById('searchTipsPopover');
        popover.style.display = popover.style.display === 'none' ? 'block' : 'none';
    });
    // Close tips when clicking outside
    document.addEventListener('click', (e) => {
        const popover = document.getElementById('searchTipsPopover');
        const btn = document.getElementById('searchTipsBtn');
        if (popover && popover.style.display !== 'none' && !popover.contains(e.target) && e.target !== btn) {
            popover.style.display = 'none';
        }
    });

    // Initial remove button handler
    setupFilterRowEvents();

    // Tab switching
    document.querySelectorAll('.tab-button').forEach(button => {
        button.addEventListener('click', (e) => switchTab(e.target.dataset.tab));
    });

    // Query execution
    document.getElementById('executeQuery').addEventListener('click', executeQuery);
    document.getElementById('clearQuery').addEventListener('click', () => {
        sqlQuery.value = '';
        queryResults.innerHTML = '<p>No query executed yet.</p>';
    });

    // Create database form
    document.getElementById('createDatabaseForm').addEventListener('submit', createDatabase);


    // Export functionality
    document.getElementById('exportDatabase').addEventListener('click', showExportDatabaseModal);
    document.getElementById('exportTableBtn').addEventListener('click', showExportTableModal);
    document.getElementById('exportSelectedRows').addEventListener('click', exportSelectedRows);
    document.getElementById('exportCurrentData').addEventListener('click', exportCurrentData);
    document.getElementById('deleteAllData').addEventListener('click', handleDeleteAllData);
    document.getElementById('deleteSelectedRows').addEventListener('click', handleDeleteSelectedRows);
    document.getElementById('exportDatabaseForm').addEventListener('submit', exportDatabase);
    document.getElementById('exportTableForm').addEventListener('submit', exportTable);

    // Export modal controls
    document.getElementById('exportTableIncludeData').addEventListener('change', toggleDataExportOptions);
    document.querySelectorAll('input[name="dataExportType"]').forEach(radio => {
        radio.addEventListener('change', toggleCustomWhereClause);
    });

    // Alter table forms
    document.getElementById('addColumnForm').addEventListener('submit', addColumn);
    document.getElementById('dropColumnForm').addEventListener('submit', dropColumn);
    document.getElementById('modifyColumnForm').addEventListener('submit', modifyColumn);
    document.getElementById('addIndexForm').addEventListener('submit', addIndex);
    document.getElementById('customAlterForm').addEventListener('submit', executeCustomAlter);
    document.getElementById('dropTableBtn').addEventListener('click', dropTable);

    // Saved connections
    document.getElementById('savedConnections').addEventListener('change', fillConnectionForm);
    document.getElementById('deleteSavedConnectionBtn').addEventListener('click', deleteSavedConnection);

    // Error Log
    document.getElementById('clearErrorLogBtn').addEventListener('click', clearErrorLog);
    document.getElementById('editRowForm').addEventListener('submit', saveRowData);
}

function setupSocketListeners() {
    socket.on('connection_success', (data) => {
        isConnected = true;
        updateConnectionStatus(true);
        showNotification('Connected to database successfully!', 'success');
        showMainInterface();
        loadDatabases();

        // Store credentials in session
        if (currentCredentials) {
            fetch('/store-credentials', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    host: currentCredentials.host,
                    port: currentCredentials.port,
                    username: currentCredentials.user,
                    password: currentCredentials.password,
                    database: currentCredentials.database,
                    engine: currentCredentials.engine,
                    ssl: currentCredentials.ssl
                })
            })
                .then(res => res.json())
                .then(data => {
                    if (data.success && data.token) {
                        localStorage.setItem('mysql_jwt_token', data.token);
                    }
                });
        }
    });

    socket.on('connection_error', (data) => {
        showNotification(data.message, 'error');
        updateConnectionStatus(false);
    });

    socket.on('disconnection_success', (data) => {
        isConnected = false;
        updateConnectionStatus(false);
        showNotification('Disconnected from database', 'info');
        showConnectionPanel();
    });

    socket.on('databases_list', (databases) => {
        populateDatabaseList(databases);
        populateQueryDatabaseSelect(databases);
    });

    socket.on('tables_list', (data) => {
        populateTableList(data.tables);
        currentDatabase = data.database;
    });

    socket.on('table_structure', (data) => {
        currentTableStructure = data.structure;
        populateTableStructure(data.structure);
        // We can also identify the primary key here, but we'll do it when populating data or structure
    });

    socket.on('table_data', (data) => {
        populateTableData(data);
        updatePagination(data);
    });

    socket.on('data_deleted', (data) => {
        showNotification(data.message, 'success');
        loadTableData(); // Refresh data
    });

    socket.on('query_result', (data) => {
        displayQueryResult(data);
    });

    socket.on('database_created', (data) => {
        showNotification(data.message, 'success');
        closeModal('createDatabaseModal');
        loadDatabases();
    });

    socket.on('database_dropped', (data) => {
        showNotification(data.message, 'success');
        loadDatabases();
    });

    socket.on('table_altered', (data) => {
        showNotification(data.message, 'success');
        loadTableStructure();
        loadTableIndexes();
        loadTables(); // Refresh tables list in case table was renamed
    });

    socket.on('table_indexes', (data) => {
        populateTableIndexes(data.indexes);
    });

    socket.on('table_dropped', (data) => {
        showNotification(data.message, 'success');
        clearTableData();
        loadTables(); // Refresh tables list
    });

    socket.on('database_exported', (data) => {
        // Data content might be a buffer (for ZIP) or string (for SQL)
        downloadFile(data.filename, data.content, data.isZip);
        showNotification(`Database exported successfully! File size: ${formatFileSize(data.size)}`, 'success');
        closeModal('exportDatabaseModal');
    });

    socket.on('table_exported', (data) => {
        downloadFile(data.filename, data.content);
        showNotification(`Table exported successfully! File size: ${formatFileSize(data.size)}`, 'success');
        closeModal('exportTableModal');
    });

    socket.on('row_count_result', (data) => {
        const preview = document.getElementById('rowCountPreview');
        if (preview) {
            preview.textContent = `Estimated rows: ${data.count}`;
        }
    });

    socket.on('error', (data) => {
        showNotification(data.message, 'error');
    });

    socket.on('query_execution_error', (data) => {
        addErrorToLog(data);
        // Ensure the log container is visible
        const container = document.getElementById('errorLogContainer');
        if (container.style.display === 'none') {
            container.style.display = 'flex';
        }
    });

    socket.on('row_updated', (data) => {
        showNotification(data.message, 'success');
        closeModal('editRowModal');
        loadTableData(); // Refresh data
    });

}

function handleConnection(e) {
    e.preventDefault();
    const formData = new FormData(connectionForm);

    const credentials = {
        host: formData.get('host'),
        port: parseInt(formData.get('port')),
        user: formData.get('user'),
        password: formData.get('password'),
        database: formData.get('database') || undefined,
        engine: document.getElementById('engine').value,
        ssl: null
    };

    // Check for SSL configuration
    const sslCa = formData.get('sslCa').trim();
    const sslCert = formData.get('sslCert').trim();
    const sslKey = formData.get('sslKey').trim();
    const rejectUnauthorized = document.getElementById('rejectUnauthorized').checked;

    if (sslCa || sslCert || sslKey) {
        credentials.ssl = {
            rejectUnauthorized: rejectUnauthorized
        };
        if (sslCa) credentials.ssl.ca = sslCa;
        if (sslCert) credentials.ssl.cert = sslCert;
        if (sslKey) credentials.ssl.key = sslKey;
    }

    currentCredentials = credentials;

    // Save connection if requested
    if (document.getElementById('saveConnection').checked) {
        saveConnection(credentials);
    }

    socket.emit('connect_database', credentials);
    showNotification('Connecting to database...', 'info');
}

function saveConnection(credentials) {
    const savedConnections = JSON.parse(localStorage.getItem('mysql_saved_connections') || '[]');

    // Check if connection already exists
    const existingIndex = savedConnections.findIndex(c =>
        c.host === credentials.host &&
        c.port === credentials.port &&
        c.user === credentials.user
    );

    if (existingIndex !== -1) {
        savedConnections[existingIndex] = credentials;
    } else {
        savedConnections.push(credentials);
    }

    localStorage.setItem('mysql_saved_connections', JSON.stringify(savedConnections));
    loadSavedConnections(); // Refresh the list
}

function loadSavedConnections() {
    const savedConnections = JSON.parse(localStorage.getItem('mysql_saved_connections') || '[]');
    const select = document.getElementById('savedConnections');
    const wrapper = document.getElementById('savedConnectionsWrapper');

    // Clear existing options except the first one
    while (select.options.length > 1) {
        select.remove(1);
    }

    if (savedConnections.length > 0) {
        wrapper.style.display = 'block';
        savedConnections.forEach((conn, index) => {
            const option = document.createElement('option');
            option.value = index;
            const engineLabel = (conn.engine === 'postgresql') ? 'PG' : 'MySQL';
            option.textContent = `[${engineLabel}] ${conn.user}@${conn.host}:${conn.port}`;
            select.appendChild(option);
        });
    } else {
        wrapper.style.display = 'none';
    }
}

function fillConnectionForm() {
    const select = document.getElementById('savedConnections');
    const index = select.value;

    if (index === '') return;

    const savedConnections = JSON.parse(localStorage.getItem('mysql_saved_connections') || '[]');
    const conn = savedConnections[index];

    if (conn) {
        document.getElementById('host').value = conn.host;
        document.getElementById('port').value = conn.port;
        document.getElementById('user').value = conn.user;
        document.getElementById('password').value = conn.password;
        if (conn.database) document.getElementById('database').value = conn.database;

        // Restore engine selection
        if (conn.engine) {
            document.getElementById('engine').value = conn.engine;
            localStorage.setItem('db_engine', conn.engine);
        }

        // Handle SSL fields if present
        if (conn.ssl) {
            if (conn.ssl.ca) document.getElementById('sslCa').value = conn.ssl.ca;
            if (conn.ssl.cert) document.getElementById('sslCert').value = conn.ssl.cert;
            if (conn.ssl.key) document.getElementById('sslKey').value = conn.ssl.key;

            // Show advanced options if SSL data exists
            document.getElementById('advancedOptions').style.display = 'block';
            document.querySelector('.advanced-options-toggle .toggle-icon').textContent = '▲';
        }

        document.getElementById('saveConnection').checked = true;
    }
}

function deleteSavedConnection() {
    const select = document.getElementById('savedConnections');
    const index = select.value;

    if (index === '') {
        showNotification('Please select a connection to delete', 'error');
        return;
    }

    const savedConnections = JSON.parse(localStorage.getItem('mysql_saved_connections') || '[]');
    savedConnections.splice(index, 1);
    localStorage.setItem('mysql_saved_connections', JSON.stringify(savedConnections));

    loadSavedConnections();
    showNotification('Connection deleted successfully', 'success');

    // Clear form
    document.getElementById('connectionForm').reset();
}

function handleDisconnection() {
    socket.emit('disconnect_database');
}

function updateConnectionStatus(connected) {
    const indicator = connectionStatus.querySelector('.status-indicator');
    const text = connectionStatus.querySelector('span:last-child');

    if (connected) {
        indicator.className = 'status-indicator connected';
        text.textContent = 'Connected';
        disconnectBtn.style.display = 'inline-block';
        logoutBtn.style.display = 'inline-block';
    } else {
        indicator.className = 'status-indicator disconnected';
        text.textContent = 'Disconnected';
        disconnectBtn.style.display = 'none';
        logoutBtn.style.display = 'none';
    }
}

function showMainInterface() {
    connectionPanel.style.display = 'none';
    mainInterface.style.display = 'flex';
}

function showConnectionPanel() {
    connectionPanel.style.display = 'block';
    mainInterface.style.display = 'none';
    logoutBtn.style.display = 'none';

    // Hide export buttons
    document.getElementById('exportDatabase').style.display = 'none';
    document.getElementById('exportCurrentData').style.display = 'none';
    document.getElementById('exportSelectedRows').style.display = 'none';

    // Reset interface
    currentDatabase = null;
    currentTable = null;
    databaseList.innerHTML = '';
    tableList.innerHTML = '';
    dataTable.querySelector('thead').innerHTML = '';
    dataTable.querySelector('tbody').innerHTML = '';
}

function loadDatabases() {
    if (!isConnected) return;
    socket.emit('get_databases');
}

function loadTables() {
    if (!isConnected || !currentDatabase) return;
    socket.emit('get_tables', currentDatabase);
}

function populateDatabaseList(databases) {
    databaseList.innerHTML = '';

    databases.forEach(database => {
        const li = document.createElement('li');
        li.textContent = database;
        li.addEventListener('click', () => selectDatabase(database, li));
        databaseList.appendChild(li);
    });
}

function populateQueryDatabaseSelect(databases) {
    const currentValue = queryDatabase.value;
    queryDatabase.innerHTML = '<option value="">Select Database</option>';

    databases.forEach(database => {
        const option = document.createElement('option');
        option.value = database;
        option.textContent = database;
        queryDatabase.appendChild(option);
    });

    if (currentValue) {
        queryDatabase.value = currentValue;
    }
}

function selectDatabase(database, element) {
    // Update UI
    document.querySelectorAll('.database-list li').forEach(li => li.classList.remove('active'));
    element.classList.add('active');

    currentDatabase = database;
    currentTable = null;

    // Show export button
    document.getElementById('exportDatabase').style.display = 'inline-block';

    // Clear table list and data
    tableList.innerHTML = '';
    clearTableData();

    // Load tables for this database
    socket.emit('get_tables', database);
}

function populateTableList(tables) {
    tableList.innerHTML = '';

    tables.forEach(table => {
        const li = document.createElement('li');
        li.textContent = table;
        li.addEventListener('click', () => selectTable(table, li));
        tableList.appendChild(li);
    });
}

function selectTable(table, element) {
    // Update UI
    document.querySelectorAll('.table-list li').forEach(li => li.classList.remove('active'));
    element.classList.add('active');

    currentTable = table;
    selectedTableSpan.textContent = `${currentDatabase}.${table}`;

    // Show export buttons
    document.getElementById('exportCurrentData').style.display = 'inline-block';
    document.getElementById('exportSelectedRows').style.display = 'inline-block';

    // Reset pagination
    currentTable = table;
    selectedTableSpan.textContent = `${currentDatabase}.${currentTable}`;
    currentPage = 1;
    currentSortColumn = null;
    currentSortDirection = 'ASC';
    currentSearchFilters = [];
    currentSearchLogic = 'AND';

    // Reset pagination controls
    document.getElementById('prevPage').disabled = true;
    document.getElementById('nextPage').disabled = true;

    // Get table structure for metadata (PKs, Nullable fields)
    socket.emit('get_table_structure', {
        database: currentDatabase,
        table: currentTable
    });

    socket.emit('get_table_data', {
        database: currentDatabase,
        table: currentTable,
        limit: pageSize,
        offset: 0,
        sortColumn: currentSortColumn,
        sortDirection: currentSortDirection,
        searchFilters: currentSearchFilters.length > 0 ? currentSearchFilters : null,
        searchLogic: currentSearchLogic
    });

    loadTableIndexes();
    populateAlterFormColumns();
}

function loadTableData() {
    if (!currentDatabase || !currentTable) return;

    const offset = (currentPage - 1) * pageSize;
    socket.emit('get_table_data', {
        database: currentDatabase,
        table: currentTable,
        limit: pageSize,
        offset: offset,
        sortColumn: currentSortColumn,
        sortDirection: currentSortDirection,
        searchFilters: currentSearchFilters.length > 0 ? currentSearchFilters : null,
        searchLogic: currentSearchLogic
    });
}

function loadTableStructure() {
    if (!currentDatabase || !currentTable) return;

    socket.emit('get_table_structure', {
        database: currentDatabase,
        table: currentTable
    });
}

function loadTableIndexes() {
    if (!currentDatabase || !currentTable) return;

    socket.emit('get_table_indexes', {
        database: currentDatabase,
        table: currentTable
    });
}

function populateTableIndexes(indexes) {
    const tbody = indexesTable.querySelector('tbody');
    tbody.innerHTML = '';

    indexes.forEach(index => {
        const tr = document.createElement('tr');

        const keyName = document.createElement('td');
        keyName.textContent = index.Key_name;
        tr.appendChild(keyName);

        const column = document.createElement('td');
        column.textContent = index.Column_name;
        tr.appendChild(column);

        const unique = document.createElement('td');
        unique.textContent = index.Non_unique === 0 ? 'Yes' : 'No';
        tr.appendChild(unique);

        const type = document.createElement('td');
        type.textContent = index.Index_type;
        tr.appendChild(type);

        const cardinality = document.createElement('td');
        cardinality.textContent = index.Cardinality || '';
        tr.appendChild(cardinality);

        tbody.appendChild(tr);
    });
}

function populateAlterFormColumns() {
    if (!currentDatabase || !currentTable) return;

    // Get current table structure
    socket.emit('get_table_structure', {
        database: currentDatabase,
        table: currentTable
    });
}

function updateAlterFormColumns(structure) {
    const dropColumnSelect = document.getElementById('dropColumnName');
    const modifyColumnSelect = document.getElementById('modifyColumnName');
    const indexColumnsSelect = document.getElementById('newIndexColumns');

    // Clear existing options
    dropColumnSelect.innerHTML = '<option value="">Select Column</option>';
    modifyColumnSelect.innerHTML = '<option value="">Select Column</option>';
    indexColumnsSelect.innerHTML = '';

    structure.forEach(field => {
        const dropOption = document.createElement('option');
        dropOption.value = field.Field;
        dropOption.textContent = field.Field;
        dropColumnSelect.appendChild(dropOption);

        const modifyOption = document.createElement('option');
        modifyOption.value = field.Field;
        modifyOption.textContent = `${field.Field} (${field.Type})`;
        modifyColumnSelect.appendChild(modifyOption);

        const indexOption = document.createElement('option');
        indexOption.value = field.Field;
        indexOption.textContent = field.Field;
        indexColumnsSelect.appendChild(indexOption);
    });
}

function addColumn(e) {
    e.preventDefault();

    const columnName = document.getElementById('newColumnName').value.trim();
    const columnType = document.getElementById('newColumnType').value;
    const allowNull = document.getElementById('newColumnNull').checked;
    const defaultValue = document.getElementById('newColumnDefault').value.trim();
    const position = document.getElementById('newColumnPosition').value;

    if (!columnName || !columnType) {
        showNotification('Please fill in column name and type', 'error');
        return;
    }

    let alterQuery = `ALTER TABLE \`${currentTable}\` ADD COLUMN \`${columnName}\` ${columnType}`;

    if (!allowNull) {
        alterQuery += ' NOT NULL';
    }

    if (defaultValue) {
        alterQuery += ` DEFAULT '${defaultValue}'`;
    }

    if (position === 'FIRST') {
        alterQuery += ' FIRST';
    }

    socket.emit('alter_table', {
        database: currentDatabase,
        table: currentTable,
        alterQuery: alterQuery
    });

    // Clear form
    document.getElementById('addColumnForm').reset();
}

function dropColumn(e) {
    e.preventDefault();

    const columnName = document.getElementById('dropColumnName').value;

    if (!columnName) {
        showNotification('Please select a column to drop', 'error');
        return;
    }

    if (!confirm(`Are you sure you want to drop column '${columnName}'? This action cannot be undone.`)) {
        return;
    }

    const alterQuery = `ALTER TABLE \`${currentTable}\` DROP COLUMN \`${columnName}\``;

    socket.emit('alter_table', {
        database: currentDatabase,
        table: currentTable,
        alterQuery: alterQuery
    });

    // Clear form
    document.getElementById('dropColumnForm').reset();
}

function modifyColumn(e) {
    e.preventDefault();

    const columnName = document.getElementById('modifyColumnName').value;
    const columnType = document.getElementById('modifyColumnType').value;
    const allowNull = document.getElementById('modifyColumnNull').checked;
    const defaultValue = document.getElementById('modifyColumnDefault').value.trim();

    if (!columnName || !columnType) {
        showNotification('Please select column and specify new type', 'error');
        return;
    }

    let alterQuery = `ALTER TABLE \`${currentTable}\` MODIFY COLUMN \`${columnName}\` ${columnType}`;

    if (!allowNull) {
        alterQuery += ' NOT NULL';
    }

    if (defaultValue) {
        alterQuery += ` DEFAULT '${defaultValue}'`;
    }

    socket.emit('alter_table', {
        database: currentDatabase,
        table: currentTable,
        alterQuery: alterQuery
    });

    // Clear form
    document.getElementById('modifyColumnForm').reset();
}

function addIndex(e) {
    e.preventDefault();

    const indexName = document.getElementById('newIndexName').value.trim();
    const selectedColumns = Array.from(document.getElementById('newIndexColumns').selectedOptions)
        .map(option => option.value);
    const indexType = document.getElementById('newIndexType').value;

    if (!indexName || selectedColumns.length === 0) {
        showNotification('Please specify index name and select columns', 'error');
        return;
    }

    const columnsStr = selectedColumns.map(col => `\`${col}\``).join(', ');
    let alterQuery;

    if (indexType === 'UNIQUE') {
        alterQuery = `ALTER TABLE \`${currentTable}\` ADD UNIQUE KEY \`${indexName}\` (${columnsStr})`;
    } else if (indexType === 'FULLTEXT') {
        alterQuery = `ALTER TABLE \`${currentTable}\` ADD FULLTEXT KEY \`${indexName}\` (${columnsStr})`;
    } else {
        alterQuery = `ALTER TABLE \`${currentTable}\` ADD KEY \`${indexName}\` (${columnsStr})`;
    }

    socket.emit('alter_table', {
        database: currentDatabase,
        table: currentTable,
        alterQuery: alterQuery
    });

    // Clear form
    document.getElementById('addIndexForm').reset();
}

function executeCustomAlter(e) {
    e.preventDefault();

    const customQuery = document.getElementById('customAlterQuery').value.trim();

    if (!customQuery) {
        showNotification('Please enter an ALTER statement', 'error');
        return;
    }

    socket.emit('alter_table', {
        database: currentDatabase,
        table: currentTable,
        alterQuery: customQuery
    });

    // Clear form
    document.getElementById('customAlterForm').reset();
}

function dropTable() {
    if (!currentTable || !currentDatabase) {
        showNotification('No table selected', 'error');
        return;
    }

    const confirmation = prompt(`Type '${currentTable}' to confirm dropping this table:`);
    if (confirmation !== currentTable) {
        showNotification('Table name confirmation failed', 'error');
        return;
    }

    socket.emit('drop_table', {
        database: currentDatabase,
        table: currentTable
    });
}

function copyRowData(data, button) {
    // If data is a row object
    const text = JSON.stringify(data);
    navigator.clipboard.writeText(text).then(() => {
        const originalText = button.innerHTML; // Assuming it's an icon or text
        button.innerHTML = '✓';
        setTimeout(() => {
            button.innerHTML = originalText;
        }, 1000);
        showNotification('Row data copied to clipboard', 'success');
    }).catch(err => {
        console.error('Failed to copy: ', err);
        showNotification('Failed to copy to clipboard', 'error');
    });
}

function copyCellData(value, button) {
    let text;
    if (typeof value === 'object' && value !== null) {
        text = JSON.stringify(value);
    } else {
        text = String(value);
    }
    navigator.clipboard.writeText(text).then(() => {
        const originalText = button.innerHTML;
        button.innerHTML = '✓';
        setTimeout(() => {
            button.innerHTML = originalText;
        }, 1000);
        showNotification('Cell data copied to clipboard', 'success');
    }).catch(err => {
        console.error('Failed to copy: ', err);
        showNotification('Failed to copy to clipboard', 'error');
    });
}

function populateTableData(data) {
    const thead = dataTable.querySelector('thead');
    const tbody = dataTable.querySelector('tbody');

    // Clear existing data
    thead.innerHTML = '';
    tbody.innerHTML = '';

    // Debug logging
    console.log('Table data received:', data);

    // Check if data exists and has the expected structure
    if (!data || !data.data) {
        tbody.innerHTML = '<tr><td colspan="100%">No data structure received</td></tr>';
        return;
    }

    if (data.data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="100%">No data found</td></tr>';
        return;
    }

    // Check if first row exists and is an object
    if (!data.data[0] || typeof data.data[0] !== 'object') {
        tbody.innerHTML = '<tr><td colspan="100%">Invalid data format received</td></tr>';
        console.error('Invalid data format:', data.data[0]);
        return;
    }

    // Create header with sorting functionality
    const headerRow = document.createElement('tr');

    // Add empty header for row copy button if not already there (it will be added after checkbox if present)
    const actionTh = document.createElement('th');
    actionTh.style.width = '70px'; // Increased from 40px to fit both buttons
    actionTh.style.minWidth = '70px';
    // We'll append this after the checkbox header if it exists, or first if not.


    // Add checkbox column header if PK exists
    if (currentPrimaryKey) {
        const th = document.createElement('th');
        th.style.width = '30px';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.addEventListener('change', (e) => {
            const checked = e.target.checked;
            document.querySelectorAll('.row-checkbox').forEach(cb => cb.checked = checked);
        });
        th.appendChild(checkbox);
        headerRow.appendChild(th);
    }

    // Append the action column header
    headerRow.appendChild(actionTh);

    const columns = Object.keys(data.data[0]);

    columns.forEach(column => {
        const th = document.createElement('th');
        th.className = 'sortable-header';
        th.textContent = column;
        th.setAttribute('data-column', column);

        // Add sort indicator if this column is currently sorted
        if (data.sortColumn === column) {
            const indicator = document.createElement('span');
            indicator.className = `sort-indicator ${data.sortDirection.toLowerCase()}`;
            th.appendChild(indicator);
        }

        // Add click handler for sorting
        th.addEventListener('click', () => sortByColumn(column));

        headerRow.appendChild(th);
    });

    thead.appendChild(headerRow);

    // Update search column dropdowns
    cachedColumns = columns;
    updateAllFilterColumnDropdowns();

    // Create data rows
    data.data.forEach(row => {
        const tr = document.createElement('tr');

        // Add checkbox if PK exists
        if (currentPrimaryKey) {
            const td = document.createElement('td');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'row-checkbox';
            checkbox.value = row[currentPrimaryKey];
            td.appendChild(checkbox);
            tr.appendChild(td);
        }

        // Add row copy button cell
        const copyBtnTd = document.createElement('td');
        // Removed fixed width here, let header control it
        copyBtnTd.style.whiteSpace = 'nowrap';
        copyBtnTd.style.textAlign = 'center';
        copyBtnTd.className = 'action-cell';

        const rowCopyBtn = document.createElement('button');
        rowCopyBtn.className = 'row-copy-btn';
        rowCopyBtn.innerHTML = '📄';
        rowCopyBtn.title = 'Copy entire row';
        rowCopyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            copyRowData(row, e.target);
        });

        // Add row edit button
        if (currentPrimaryKey) {
            const rowEditBtn = document.createElement('button');
            rowEditBtn.className = 'row-copy-btn'; // Reuse style for now
            rowEditBtn.innerHTML = '✏️';
            rowEditBtn.title = 'Edit row';
            rowEditBtn.style.marginLeft = '5px';
            rowEditBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openEditRowModal(row);
            });
            copyBtnTd.appendChild(rowEditBtn);
        }

        copyBtnTd.appendChild(rowCopyBtn);
        tr.appendChild(copyBtnTd);

        columns.forEach(column => {
            const td = document.createElement('td');
            const value = row[column];

            // Handle null values
            if (value === null) {
                td.textContent = 'NULL';
                td.style.fontStyle = 'italic';
                td.style.color = '#888';
                td.className = 'data-cell';
            } else {
                let stringValue;
                if (typeof value === 'object') {
                    stringValue = JSON.stringify(value);
                } else {
                    stringValue = String(value);
                }

                // Determine content type and apply appropriate styling
                if (typeof value === 'number') {
                    td.textContent = stringValue;
                    td.className = 'data-cell numeric-content';
                } else if (stringValue.length > 100) {
                    // Long text content - show truncated with full text in title
                    td.className = 'data-cell long-text';
                    td.textContent = stringValue.substring(0, 100) + '...';
                    td.title = stringValue; // Show full text on hover
                } else if (stringValue.includes('\n') || stringValue.includes('\t')) {
                    // Multi-line or formatted content
                    td.textContent = stringValue;
                    td.className = 'data-cell text-content';
                } else if (/^[A-Z_][A-Z0-9_]*$/i.test(stringValue) && stringValue.length > 10) {
                    // Looks like code/identifiers
                    td.textContent = stringValue;
                    td.className = 'data-cell code-content';
                } else {
                    // Regular text content
                    td.textContent = stringValue;
                    td.className = 'data-cell text-content';
                }
            }

            // Add cell copy button
            const cellCopyBtn = document.createElement('button');
            cellCopyBtn.className = 'cell-copy-btn';
            cellCopyBtn.innerHTML = '📋';
            cellCopyBtn.title = 'Copy cell data';
            cellCopyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                copyCellData(value, e.target);
            });
            td.appendChild(cellCopyBtn);

            tr.appendChild(td);
        });

        tbody.appendChild(tr);
    });

    // Show delete buttons
    document.getElementById('deleteAllData').style.display = 'inline-block';
    if (currentPrimaryKey) {
        document.getElementById('deleteSelectedRows').style.display = 'inline-block';
    } else {
        document.getElementById('deleteSelectedRows').style.display = 'none';
        showNotification('Primary Key not found. Row deletion disabled.', 'warning');
    }

    // Show search info if search is active
    updateSearchInfo(data);

    // Check if table is horizontally scrollable and add indicator
    addScrollIndicator(dataTable.closest('.table-container'));
}

function addScrollIndicator(tableContainer) {
    if (!tableContainer) return;

    // Remove existing indicator
    const existingIndicator = tableContainer.querySelector('.scroll-indicator');
    if (existingIndicator) {
        existingIndicator.remove();
    }

    // Check if content is wider than container
    const table = tableContainer.querySelector('table');
    if (table && table.scrollWidth > tableContainer.clientWidth) {
        tableContainer.classList.add('scrollable');

        // Create scroll indicator element
        const indicator = document.createElement('div');
        indicator.className = 'scroll-indicator';
        indicator.textContent = '↔ Scroll horizontally to view all columns';

        // Position the indicator relative to the container
        tableContainer.style.position = 'relative';
        tableContainer.appendChild(indicator);

        // Auto-hide after 4 seconds
        setTimeout(() => {
            if (indicator.parentElement) {
                indicator.style.transition = 'opacity 0.5s ease-out';
                indicator.style.opacity = '0';
                setTimeout(() => {
                    if (indicator.parentElement) {
                        indicator.remove();
                    }
                }, 500);
            }
        }, 4000);

        // Add scroll listener to show progress indicator
        let scrollTimeout;
        tableContainer.addEventListener('scroll', (e) => {
            // Clear existing timeout
            if (scrollTimeout) {
                clearTimeout(scrollTimeout);
            }

            // Show scroll progress if user is scrolling horizontally
            if (e.target.scrollLeft > 0) {
                showScrollProgress(tableContainer, e.target.scrollLeft, e.target.scrollWidth - e.target.clientWidth);
            }

            // Hide progress after scrolling stops
            scrollTimeout = setTimeout(() => {
                hideScrollProgress(tableContainer);
            }, 1000);
        });

    } else {
        tableContainer.classList.remove('scrollable');
    }
}

function showScrollProgress(container, scrollLeft, maxScroll) {
    let progressBar = container.querySelector('.scroll-progress');

    if (!progressBar) {
        progressBar = document.createElement('div');
        progressBar.className = 'scroll-progress';
        progressBar.innerHTML = `
            <div class="scroll-progress-bar">
                <div class="scroll-progress-fill"></div>
            </div>
            <div class="scroll-progress-text">Scrolling...</div>
        `;
        container.appendChild(progressBar);

        // Add CSS for progress bar if not exists
        if (!document.querySelector('#scroll-progress-styles')) {
            const style = document.createElement('style');
            style.id = 'scroll-progress-styles';
            style.textContent = `
                .scroll-progress {
                    position: absolute;
                    top: 10px;
                    right: 10px;
                    background: rgba(0,0,0,0.8);
                    color: white;
                    padding: 6px 10px;
                    border-radius: 16px;
                    font-size: 10px;
                    z-index: 1000;
                    min-width: 80px;
                    text-align: center;
                }
                .scroll-progress-bar {
                    width: 60px;
                    height: 3px;
                    background: rgba(255,255,255,0.3);
                    border-radius: 2px;
                    margin: 4px auto 2px;
                    overflow: hidden;
                }
                .scroll-progress-fill {
                    height: 100%;
                    background: #007bff;
                    border-radius: 2px;
                    transition: width 0.1s ease;
                }
            `;
            document.head.appendChild(style);
        }
    }

    // Update progress
    const progressPercentage = (scrollLeft / maxScroll) * 100;
    const fill = progressBar.querySelector('.scroll-progress-fill');
    fill.style.width = progressPercentage + '%';

    progressBar.style.opacity = '1';
}

function hideScrollProgress(container) {
    const progressBar = container.querySelector('.scroll-progress');
    if (progressBar) {
        progressBar.style.opacity = '0';
        setTimeout(() => {
            if (progressBar.parentElement) {
                progressBar.remove();
            }
        }, 300);
    }
}

function updateAllFilterColumnDropdowns() {
    const filterRows = document.querySelectorAll('.search-filter-row');
    filterRows.forEach(row => {
        const select = row.querySelector('.filter-column');
        const currentValue = select.value;
        select.innerHTML = '<option value="">Select Column</option>';
        cachedColumns.forEach(column => {
            const option = document.createElement('option');
            option.value = column;
            option.textContent = column;
            select.appendChild(option);
        });
        if (currentValue && cachedColumns.includes(currentValue)) {
            select.value = currentValue;
        }
    });
}

function addSearchFilterRow() {
    const container = document.getElementById('searchFiltersContainer');
    const row = document.createElement('div');
    row.className = 'search-filter-row';
    row.innerHTML = `
        <select class="filter-column">
            <option value="">Select Column</option>
        </select>
        <select class="filter-operator">
            <option value="LIKE">Contains</option>
            <option value="NOT LIKE">Not Contains</option>
        </select>
        <input type="text" class="filter-value" placeholder="Search value...">
        <button type="button" class="remove-filter-btn btn btn-danger btn-small" title="Remove filter">✕</button>
    `;
    container.appendChild(row);

    // Populate columns in the new row
    const select = row.querySelector('.filter-column');
    cachedColumns.forEach(column => {
        const option = document.createElement('option');
        option.value = column;
        option.textContent = column;
        select.appendChild(option);
    });

    // Setup events for the new row
    setupFilterRowEvents();
}

function removeSearchFilterRow(row) {
    const container = document.getElementById('searchFiltersContainer');
    const rows = container.querySelectorAll('.search-filter-row');
    // Always keep at least one row
    if (rows.length > 1) {
        row.remove();
    } else {
        // Clear the last remaining row instead of removing it
        row.querySelector('.filter-column').value = '';
        row.querySelector('.filter-operator').value = 'LIKE';
        row.querySelector('.filter-value').value = '';
    }
}

function setupFilterRowEvents() {
    const container = document.getElementById('searchFiltersContainer');
    container.querySelectorAll('.remove-filter-btn').forEach(btn => {
        // Remove old listeners by cloning
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', () => removeSearchFilterRow(newBtn.closest('.search-filter-row')));
    });

    // Add Enter key support to all filter value inputs
    container.querySelectorAll('.filter-value').forEach(input => {
        const newInput = input.cloneNode(true);
        input.parentNode.replaceChild(newInput, input);
        newInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') performSearch();
        });
    });
}

function updateSearchInfo(data) {
    // Remove existing search info
    const existingInfo = document.querySelector('.search-info');
    if (existingInfo) {
        existingInfo.remove();
    }

    // Add search info if search filters are active
    if (data.searchFilters && Array.isArray(data.searchFilters) && data.searchFilters.length > 0) {
        const validFilters = data.searchFilters.filter(f => f.column && f.value);
        if (validFilters.length > 0) {
            const logic = data.searchLogic || 'AND';
            const filterDescriptions = validFilters.map(f => {
                const op = f.operator === 'NOT LIKE' ? 'not in' : 'in';
                return `"${f.value}" ${op} "${f.column}"`;
            });
            const searchInfo = document.createElement('div');
            searchInfo.className = 'search-info';
            searchInfo.textContent = `Filtering: ${filterDescriptions.join(` ${logic} `)} (${data.total} matches)`;

            const dataControls = document.querySelector('.data-controls');
            dataControls.insertAdjacentElement('afterend', searchInfo);
        }
    }
}

function sortByColumn(column) {
    if (currentSortColumn === column) {
        // Toggle sort direction
        currentSortDirection = currentSortDirection === 'ASC' ? 'DESC' : 'ASC';
    } else {
        // New column, default to ASC
        currentSortColumn = column;
        currentSortDirection = 'ASC';
    }

    // Reset to first page when sorting
    currentPage = 1;
    loadTableData();
}

function performSearch() {
    const filterRows = document.querySelectorAll('.search-filter-row');
    const filters = [];
    let hasIncomplete = false;

    filterRows.forEach(row => {
        const column = row.querySelector('.filter-column').value;
        const operator = row.querySelector('.filter-operator').value;
        const value = row.querySelector('.filter-value').value.trim();

        if (column && value) {
            filters.push({ column, value, operator });
        } else if (column && !value) {
            hasIncomplete = true;
        } else if (!column && value) {
            hasIncomplete = true;
        }
    });

    if (hasIncomplete && filters.length === 0) {
        showNotification('Please select a column and enter a value for each filter', 'error');
        return;
    }

    currentSearchFilters = filters;
    currentSearchLogic = document.getElementById('searchLogic').value;
    currentPage = 1;

    // Update filter input styling
    filterRows.forEach(row => {
        const column = row.querySelector('.filter-column').value;
        const value = row.querySelector('.filter-value').value.trim();
        const input = row.querySelector('.filter-value');
        if (column && value) {
            input.classList.add('search-active');
        } else {
            input.classList.remove('search-active');
        }
    });

    loadTableData();
}

function clearSearch() {
    const container = document.getElementById('searchFiltersContainer');
    // Reset to a single empty row
    container.innerHTML = `
        <div class="search-filter-row">
            <select class="filter-column">
                <option value="">Select Column</option>
            </select>
            <select class="filter-operator">
                <option value="LIKE">Contains</option>
                <option value="NOT LIKE">Not Contains</option>
            </select>
            <input type="text" class="filter-value" placeholder="Search value...">
            <button type="button" class="remove-filter-btn btn btn-danger btn-small" title="Remove filter">✕</button>
        </div>
    `;

    // Repopulate columns in the reset row
    updateAllFilterColumnDropdowns();
    setupFilterRowEvents();

    document.getElementById('searchLogic').value = 'AND';
    currentSearchFilters = [];
    currentSearchLogic = 'AND';
    currentPage = 1;

    // Remove search info
    const existingInfo = document.querySelector('.search-info');
    if (existingInfo) {
        existingInfo.remove();
    }

    loadTableData();
}

function jumpToPage() {
    const input = document.getElementById('pageJump');
    const page = parseInt(input.value);

    if (isNaN(page) || page < 1) {
        showNotification('Please enter a valid page number', 'error');
        return;
    }

    if (page > totalPages) {
        showNotification(`Page ${page} does not exist. Max page is ${totalPages}`, 'error');
        return;
    }

    currentPage = page;
    input.value = '';
    loadTableData();
}


// ... (other global variables remain same)

function populateTableStructure(structure) {
    const tbody = structureTable.querySelector('tbody');
    tbody.innerHTML = '';

    // reset primary key
    currentPrimaryKey = null;

    structure.forEach(field => {
        if (field.Key === 'PRI') {
            currentPrimaryKey = field.Field;
        }

        const tr = document.createElement('tr');

        // Add row copy button (and edit button) column
        const copyBtnTd = document.createElement('td');
        copyBtnTd.className = 'action-cell';
        copyBtnTd.style.whiteSpace = 'nowrap';
        copyBtnTd.style.textAlign = 'center';

        const rowCopyBtn = document.createElement('button');
        rowCopyBtn.className = 'row-copy-btn';
        rowCopyBtn.innerHTML = '📄';
        rowCopyBtn.title = 'Copy entire row';
        rowCopyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            copyRowData(field, e.target);
        });
        tr.appendChild(rowCopyBtn);


        ['Field', 'Type', 'Null', 'Key', 'Default', 'Extra'].forEach((prop, index) => {
            const td = document.createElement('td');
            const value = field[prop];

            if (value === null || value === '') {
                td.textContent = '';
                td.style.color = '#888';
            } else {
                const stringValue = String(value);

                // Apply specific styling based on column type
                switch (index) {
                    case 0: // Field name
                        td.textContent = stringValue;
                        td.className = 'code-content';
                        break;
                    case 1: // Type
                        td.textContent = stringValue;
                        td.className = 'code-content';
                        if (stringValue.length > 50) {
                            td.className += ' long-text';
                            td.title = stringValue; // Show full text on hover
                        }
                        break;
                    case 4: // Default
                        if (stringValue.length > 30) {
                            td.className = 'long-text';
                            td.textContent = stringValue.substring(0, 30) + '...';
                            td.title = stringValue; // Show full text on hover
                        } else {
                            td.textContent = stringValue;
                            td.className = 'text-content';
                        }
                        break;
                    default:
                        td.textContent = stringValue;
                        td.className = 'text-content';
                }
            }

            // Add cell copy button
            const cellCopyBtn = document.createElement('button');
            cellCopyBtn.className = 'cell-copy-btn';
            cellCopyBtn.innerHTML = '📋';
            cellCopyBtn.title = 'Copy cell data';
            cellCopyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                copyCellData(value, e.target);
            });
            td.appendChild(cellCopyBtn);

            tr.appendChild(td);
        });

        // Add Actions Column
        const actionTd = document.createElement('td');

        // Edit Column Button
        const editBtn = document.createElement('button');
        editBtn.className = 'btn btn-small btn-primary';
        editBtn.textContent = 'Edit';
        editBtn.style.marginRight = '5px';
        editBtn.onclick = () => {
            // Pre-fill modify form
            document.getElementById('modifyColumnName').value = field.Field;
            // Switch to Alter Table tab
            switchTab('alter');
        };

        // Drop Column Button
        const dropBtn = document.createElement('button');
        dropBtn.className = 'btn btn-small btn-danger';
        dropBtn.innerHTML = '🗑️';
        dropBtn.title = 'Drop Column';
        dropBtn.onclick = () => deleteColumn(field.Field);

        actionTd.appendChild(editBtn);
        actionTd.appendChild(dropBtn);
        tr.appendChild(actionTd);

        tbody.appendChild(tr);
    });

    // Update alter form columns
    updateAlterFormColumns(structure);

    // Add scroll indicator if needed
    addScrollIndicator(structureTable.closest('.table-container'));
}

function updatePagination(data) {
    totalPages = Math.ceil(data.total / data.limit);
    pageInfo.textContent = `Page ${currentPage} of ${totalPages} (${data.total} total rows)`;

    document.getElementById('prevPage').disabled = currentPage <= 1;
    document.getElementById('nextPage').disabled = currentPage >= totalPages;
}

function changePage(direction) {
    const newPage = currentPage + direction;
    if (newPage >= 1 && newPage <= totalPages) {
        currentPage = newPage;
        loadTableData();
    }
}

function changePageSize() {
    pageSize = parseInt(document.getElementById('pageSize').value);
    currentPage = 1;
    loadTableData();
}

function clearTableData() {
    dataTable.querySelector('thead').innerHTML = '';
    dataTable.querySelector('tbody').innerHTML = '';
    structureTable.querySelector('tbody').innerHTML = '';
    selectedTableSpan.textContent = 'Select a table to view data';
}

function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.getElementById(`${tabName}Tab`).classList.add('active');
}

function executeQuery() {
    const query = sqlQuery.value.trim();
    const database = queryDatabase.value;

    if (!query) {
        showNotification('Please enter a SQL query', 'error');
        return;
    }

    socket.emit('execute_query', { database, query });
    queryResults.innerHTML = '<p>Executing query, please wait...</p>';
}

function displayQueryResult(data) {
    const { query, result } = data;

    let html = `<div class="query-info"><strong>Query:</strong> ${query}</div>`;

    if (result.type === 'SELECT') {
        if (result.multipleStatements) {
            // Handle multiple SELECT statements
            html += `<p><strong>Multiple statements executed:</strong> ${result.data.length}</p>`;
            html += `<p><strong>Total rows returned:</strong> ${result.rowCount}</p>`;

            result.data.forEach((statementResult, index) => {
                html += `<div class="statement-result">`;
                html += `<h4>Statement ${index + 1}: ${statementResult.statement}</h4>`;

                if (statementResult.data.length === 0) {
                    html += '<p>No results found.</p>';
                } else {
                    html += `<p><strong>Rows:</strong> ${statementResult.rowCount}</p>`;
                    html += '<div class="table-container"><table>';

                    // Header
                    const columns = Object.keys(statementResult.data[0]);
                    html += '<thead><tr>';
                    columns.forEach(col => {
                        html += `<th>${col}</th>`;
                    });
                    html += '</tr></thead>';

                    // Data
                    html += '<tbody>';
                    statementResult.data.forEach(row => {
                        html += '<tr>';
                        columns.forEach(col => {
                            const value = row[col];
                            if (value === null) {
                                html += '<td class="data-cell" style="font-style: italic; color: #888;"><em>NULL</em></td>';
                            } else {
                                let stringValue;
                                if (typeof value === 'object' && value !== null) {
                                    stringValue = JSON.stringify(value);
                                } else {
                                    stringValue = String(value);
                                }
                                let cellClass = 'data-cell';
                                let displayValue = stringValue;

                                if (typeof value === 'number') {
                                    cellClass += ' numeric-content';
                                } else if (stringValue.length > 100) {
                                    cellClass += ' long-text';
                                    displayValue = stringValue.substring(0, 100) + '...';
                                    html += `<td class="${cellClass}" title="${stringValue.replace(/"/g, '&quot;')}" data-cell-value="${stringValue.replace(/"/g, '&quot;')}">${displayValue}<button class="cell-copy-btn">📋</button></td>`;
                                } else if (stringValue.includes('\n') || stringValue.includes('\t')) {
                                    cellClass += ' text-content';
                                    html += `<td class="${cellClass}" data-cell-value="${stringValue.replace(/"/g, '&quot;')}">${displayValue}<button class="cell-copy-btn">📋</button></td>`;
                                } else {
                                    cellClass += ' text-content';
                                    html += `<td class="${cellClass}" data-cell-value="${stringValue.replace(/"/g, '&quot;')}">${displayValue}<button class="cell-copy-btn">📋</button></td>`;
                                }
                            }
                        });
                        html += '</tr>';
                    });
                    html += '</tbody></table></div>';
                }
                html += `</div>`;
            });
        } else {
            // Handle single SELECT statement
            if (result.data.length === 0) {
                html += '<p>No results found.</p>';
            } else {
                html += `<p><strong>Rows returned:</strong> ${result.rowCount}</p>`;
                html += '<div class="table-container"><table>';

                // Header
                const columns = Object.keys(result.data[0]);
                html += '<thead><tr>';
                columns.forEach(col => {
                    html += `<th>${col}</th>`;
                });
                html += '</tr></thead>';

                // Data
                html += '<tbody>';
                result.data.forEach(row => {
                    html += '<tr>';
                    columns.forEach(col => {
                        const value = row[col];
                        if (value === null) {
                            html += '<td class="data-cell" style="font-style: italic; color: #888;"><em>NULL</em></td>';
                        } else {
                            let stringValue;
                            if (typeof value === 'object' && value !== null) {
                                stringValue = JSON.stringify(value);
                            } else {
                                stringValue = String(value);
                            }
                            let cellClass = 'data-cell';
                            let displayValue = stringValue;

                            if (typeof value === 'number') {
                                cellClass += ' numeric-content';
                                html += `<td class="${cellClass}" data-cell-value="${displayValue}">${displayValue}<button class="cell-copy-btn">📋</button></td>`;
                            } else if (stringValue.length > 100) {
                                cellClass += ' long-text';
                                displayValue = stringValue.substring(0, 100) + '...';
                                html += `<td class="${cellClass}" title="${stringValue.replace(/"/g, '&quot;')}" data-cell-value="${stringValue.replace(/"/g, '&quot;')}">${displayValue}<button class="cell-copy-btn">📋</button></td>`;
                            } else if (stringValue.includes('\n') || stringValue.includes('\t')) {
                                cellClass += ' text-content';
                                html += `<td class="${cellClass}" data-cell-value="${stringValue.replace(/"/g, '&quot;')}">${displayValue}<button class="cell-copy-btn">📋</button></td>`;
                            } else {
                                cellClass += ' text-content';
                                html += `<td class="${cellClass}" data-cell-value="${stringValue.replace(/"/g, '&quot;')}">${displayValue}<button class="cell-copy-btn">📋</button></td>`;
                            }
                        }
                    });
                    html += '</tr>';
                });
                html += '</tbody></table></div>';
            }
        }
    } else {
        html += `<p><strong>Affected rows:</strong> ${result.affectedRows}</p>`;
        if (result.insertId) {
            html += `<p><strong>Insert ID:</strong> ${result.insertId}</p>`;
        }
        html += `<p class="success-message">${result.message}</p>`;

        // Refresh data if we're viewing a table and it might have been affected
        if (currentTable && currentDatabase) {
            loadTableData();
        }
    }

    queryResults.innerHTML = html;

    // Add event listeners for copy buttons in query results
    queryResults.querySelectorAll('.cell-copy-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            const td = e.target.closest('td');
            const cellValue = td.getAttribute('data-cell-value') || td.textContent.replace('📋', '').trim();
            copyCellData(cellValue, e.target);
        });
    });
}

function showCreateDatabaseModal() {
    document.getElementById('createDatabaseModal').style.display = 'block';
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
    // Clear form if it exists
    const form = document.querySelector(`#${modalId} form`);
    if (form) {
        form.reset();
    }
}

function createDatabase(e) {
    e.preventDefault();

    const databaseName = document.getElementById('newDatabaseName').value.trim();
    if (!databaseName) {
        showNotification('Please enter a database name', 'error');
        return;
    }

    socket.emit('create_database', databaseName);
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;

    // Create copy button for errors
    if (type === 'error') {
        const copyBtn = document.createElement('button');
        copyBtn.innerHTML = '📋';
        copyBtn.className = 'btn-text';
        copyBtn.style.marginRight = '10px';
        copyBtn.style.background = 'transparent';
        copyBtn.style.border = 'none';
        copyBtn.style.color = 'white';
        copyBtn.style.cursor = 'pointer';
        copyBtn.title = 'Copy Error';
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(message);
            showNotification('Error copied to clipboard', 'success');
        };
        notification.appendChild(copyBtn);
    }

    const textSpan = document.createElement('span');
    textSpan.textContent = message;
    notification.appendChild(textSpan);

    document.getElementById('notifications').appendChild(notification);

    // Trigger animation
    setTimeout(() => notification.classList.add('show'), 100);

    // Remove after 5 seconds
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 5000);
}

// Close modals when clicking outside
window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        e.target.style.display = 'none';
    }
});

function openEditRowModal(row) {
    if (!currentPrimaryKey) return;

    const modal = document.getElementById('editRowModal');
    const container = document.getElementById('editRowFields');
    container.innerHTML = '';

    // Store PK value on form for identification
    const form = document.getElementById('editRowForm');
    form.setAttribute('data-pk-value', row[currentPrimaryKey]);

    Object.keys(row).forEach(col => {
        const formGroup = document.createElement('div');
        formGroup.className = 'form-group';

        const label = document.createElement('label');
        label.textContent = col;
        formGroup.appendChild(label);

        const inputContainer = document.createElement('div');
        inputContainer.style.display = 'flex';
        inputContainer.style.gap = '10px';
        inputContainer.style.alignItems = 'center';

        const input = document.createElement('input');
        input.type = 'text';
        input.name = col;
        input.style.flex = '1';

        // Find column structure definition
        const colDef = currentTableStructure ? currentTableStructure.find(c => c.Field === col) : null;
        const isNullable = colDef && colDef.Null === 'YES';
        const isEnum = colDef && colDef.Type.toLowerCase().startsWith('enum(');

        let inputControl;

        if (isEnum) {
            // Parse ENUM values
            // Type format: enum('val1','val2',...)
            // Use regex to capture values inside single quotes, handling commas inside values
            const enumContent = colDef.Type.substring(5, colDef.Type.length - 1);
            const matches = enumContent.match(/'([^']*)'/g);
            const enumValues = matches ? matches.map(v => v.slice(1, -1)) : [];

            inputControl = document.createElement('div');
            inputControl.className = 'radio-group';
            inputControl.style.flex = '1';
            inputControl.style.display = 'flex';
            inputControl.style.gap = '15px';
            inputControl.style.flexWrap = 'wrap';

            enumValues.forEach(val => {
                const radioLabel = document.createElement('label');
                radioLabel.style.display = 'flex';
                radioLabel.style.alignItems = 'center';
                radioLabel.style.gap = '5px';
                radioLabel.style.cursor = 'pointer';
                radioLabel.style.fontWeight = 'normal';

                const radio = document.createElement('input');
                radio.type = 'radio';
                radio.name = col;
                radio.value = val;

                // Check if value matches
                if (row[col] === val) {
                    radio.checked = true;
                }

                radioLabel.appendChild(radio);
                radioLabel.appendChild(document.createTextNode(val));
                inputControl.appendChild(radioLabel);
            });

            // If null, no radio checked (default behavior correct)
            if (row[col] === null) {
                // disable initially if we are handling null logic below? 
                // We'll handle disabled state via the null check block below.
            }

        } else {
            inputControl = document.createElement('input');
            inputControl.type = 'text';
            inputControl.name = col;
            inputControl.style.flex = '1';

            // Null Handling for text input
            if (row[col] === null) {
                inputControl.value = 'NULL';
                inputControl.disabled = true;
            } else {
                // Handle Date formatting
                let val = row[col];
                if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(val)) {
                    val = val.replace('T', ' ').replace('Z', '');
                } else if (typeof val === 'object' && val !== null) {
                    val = JSON.stringify(val, null, 2);
                    // Use textarea for JSON to allow multi-line editing
                    // We need to replace the input element with a textarea if we want multi-line, 
                    // but for minimal disruption replacing the element here might be tricky if not planned.
                    // However, we can just set the value to the input for now, or better:
                    // If it is an object, maybe switch `inputControl` to a textarea?
                    // The `inputControl` was already created as 'input' type text at line 1761.
                    // Let's just stick to the plan: stringify it. 
                    // Ideally, we should perform this check BEFORE creating the element if we wanted a textarea.
                    // But `input` type text can hold the string, just not show newlines well.
                    // Let's stick to stringify.
                }
                inputControl.value = val;
            }

            if (col === currentPrimaryKey) {
                inputControl.disabled = true;
                inputControl.title = 'Primary Key cannot be edited';
                inputControl.id = 'pkInput'; // Mark purely for easy access

                // Add "Enable Editing" toggle for PK
                const enableContainer = document.createElement('div');
                enableContainer.style.display = 'flex';
                enableContainer.style.alignItems = 'center';
                enableContainer.style.gap = '5px';
                enableContainer.style.marginTop = '4px';
                enableContainer.style.fontSize = '0.85em';
                enableContainer.style.color = '#666';

                const enableCheckbox = document.createElement('input');
                enableCheckbox.type = 'checkbox';
                enableCheckbox.id = 'enablePkEdit';
                enableCheckbox.addEventListener('change', (e) => {
                    inputControl.disabled = !e.target.checked;
                    if (e.target.checked) {
                        inputControl.title = 'Primary Key editing enabled';
                    } else {
                        inputControl.title = 'Primary Key cannot be edited';
                    }
                });

                const enableLabel = document.createElement('label');
                enableLabel.htmlFor = 'enablePkEdit';
                enableLabel.textContent = 'Enable Editing (Main Index)';
                enableLabel.style.cursor = 'pointer';

                enableContainer.appendChild(enableCheckbox);
                enableContainer.appendChild(enableLabel);

                // We need to append this after the input, so we'll do it by appending to inputContainer
                // inputContainer is a flex row currently. 
                // To keep layout clean, we might want to wrap input + toggle or just let it be.
                // Given the current layout: inputContainer (flex row) -> inputControl
                // If we add enableContainer (flex row) to inputContainer, it will be side-by-side or squished.
                // Better to change inputContainer to column if it's the PK, OR append enableContainer OUTSIDE inputContainer but inside formGroup.
                // Let's go with appending to formGroup.
                setTimeout(() => {
                    formGroup.appendChild(enableContainer);
                }, 0);
            }
        }

        inputContainer.appendChild(inputControl);

        // Add NULL checkbox if nullable
        if (isNullable && col !== currentPrimaryKey) {
            const nullLabel = document.createElement('label');
            nullLabel.style.display = 'flex';
            nullLabel.style.alignItems = 'center';
            nullLabel.style.gap = '5px';
            nullLabel.style.fontSize = '0.9em';
            nullLabel.style.cursor = 'pointer';

            const nullCheckbox = document.createElement('input');
            nullCheckbox.type = 'checkbox';
            nullCheckbox.className = 'null-checkbox';
            nullCheckbox.dataset.column = col;
            nullCheckbox.checked = row[col] === null;

            // Initial disabled state for radios if null
            if (isEnum && row[col] === null) {
                inputControl.querySelectorAll('input[type="radio"]').forEach(r => r.disabled = true);
            }

            nullCheckbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    if (isEnum) {
                        inputControl.querySelectorAll('input[type="radio"]').forEach(r => {
                            r.disabled = true;
                            r.checked = false;
                        });
                    } else {
                        inputControl.disabled = true;
                        inputControl.value = 'NULL';
                    }
                } else {
                    if (isEnum) {
                        inputControl.querySelectorAll('input[type="radio"]').forEach(r => r.disabled = false);
                        // Restore original value? Or leave unchecked?
                        // If it was null, leave unchecked. User must select.
                        // If it wasn't null initially (e.g. user checked then unchecked null box), 
                        // we could restore, but simpler to just let them pick.
                        if (row[col] !== null && enumValues.includes(row[col])) {
                            // Optional: restore original selection if we wanted to be fancy
                            // But keep it simple
                            const originalRadio = inputControl.querySelector(`input[value="${row[col]}"]`);
                            if (originalRadio) originalRadio.checked = true;
                        }
                    } else {
                        inputControl.disabled = false;
                        let val = row[col];
                        if (val === null) val = ''; // Default to empty if was null
                        else if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(val)) {
                            val = val.replace('T', ' ').replace('Z', '');
                        }
                        inputControl.value = val;
                    }
                }
            });

            nullLabel.appendChild(nullCheckbox);
            nullLabel.appendChild(document.createTextNode('NULL'));
            inputContainer.appendChild(nullLabel);
        } else if (col === currentPrimaryKey && isEnum) {
            // Edge case: PK is enum (rare), disable radios
            inputControl.querySelectorAll('input[type="radio"]').forEach(r => r.disabled = true);
        }

        formGroup.appendChild(inputContainer);
        container.appendChild(formGroup);
    });

    modal.style.display = 'flex';
}

function saveRowData(e) {
    e.preventDefault();

    if (!currentPrimaryKey) return;

    const form = document.getElementById('editRowForm');
    const pkValue = form.getAttribute('data-pk-value');
    const formData = new FormData(form);
    const updateData = {};

    formData.forEach((value, key) => {
        if (key !== currentPrimaryKey || !document.getElementById('editRowForm').querySelector('[name="' + currentPrimaryKey + '"]').disabled) {
            // Check if there's a checked NULL checkbox for this column
            const nullCheckbox = form.querySelector(`.null-checkbox[data-column="${key}"]`);
            if (nullCheckbox && nullCheckbox.checked) {
                updateData[key] = null;
            } else {
                // Try to parse JSON if it looks like one
                if (typeof value === 'string' && (value.trim().startsWith('{') || value.trim().startsWith('['))) {
                    try {
                        updateData[key] = JSON.parse(value);
                    } catch (e) {
                        // Not valid JSON, save as string
                        updateData[key] = value;
                    }
                } else {
                    updateData[key] = value;
                }
            }
        }
    });

    socket.emit('update_row', {
        database: currentDatabase,
        table: currentTable,
        primaryKeyColumn: currentPrimaryKey,
        primaryKeyValue: pkValue,
        updateData: updateData
    });
}

function deleteColumn(columnName) {
    if (!confirm(`Are you sure you want to drop column '${columnName}'? This action cannot be undone.`)) {
        return;
    }

    const alterQuery = `ALTER TABLE \`${currentTable}\` DROP COLUMN \`${columnName}\``;

    socket.emit('alter_table', {
        database: currentDatabase,
        table: currentTable,
        alterQuery: alterQuery
    });
}


// Handle keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Ctrl+Enter to execute query
    if (e.ctrlKey && e.key === 'Enter' && document.activeElement === sqlQuery) {
        executeQuery();
    }

    // Escape to close modals
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.style.display = 'none';
        });
    }
});
function handleLogout() {
    // Disconnect from database if connected
    if (isConnected) {
        socket.emit('disconnect_database');
    }

    // Remove JWT token
    localStorage.removeItem('mysql_jwt_token');

    fetch('/logout', { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                // Reset UI state
                mainInterface.style.display = 'none';
                connectionPanel.style.display = '';
                logoutBtn.style.display = 'none';
                disconnectBtn.style.display = 'none';
                connectionStatus.innerHTML = '<span class="status-indicator disconnected"></span><span>Disconnected</span>';

                // Reset global state
                isConnected = false;
                currentCredentials = null;
                currentDatabase = null;
                currentTable = null;

                // Clear form
                connectionForm.reset();

                showNotification('Logged out successfully', 'info');
            }
        });
}

function restoreSessionCredentials() {
    const token = localStorage.getItem('mysql_jwt_token');

    // Always fetch, but add header if token exists
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

    fetch('/session-credentials', { headers })
        .then(res => res.json())
        .then(data => {
            if (data.username && data.password && data.host) { // Ensure key fields exist
                // Fill the form
                document.getElementById('user').value = data.username;
                document.getElementById('password').value = data.password;

                if (data.host) document.getElementById('host').value = data.host;
                if (data.port) document.getElementById('port').value = data.port;

                // Restore engine selection
                if (data.engine) {
                    document.getElementById('engine').value = data.engine;
                    localStorage.setItem('db_engine', data.engine);
                }

                // Handle SSL fields if present
                if (data.ssl) {
                    if (data.ssl.ca) document.getElementById('sslCa').value = data.ssl.ca;
                    if (data.ssl.cert) document.getElementById('sslCert').value = data.ssl.cert;
                    if (data.ssl.key) document.getElementById('sslKey').value = data.ssl.key;

                    if (typeof data.ssl.rejectUnauthorized !== 'undefined') {
                        document.getElementById('rejectUnauthorized').checked = data.ssl.rejectUnauthorized;
                    }

                    // Show advanced options
                    document.getElementById('advancedOptions').style.display = 'block';
                    document.querySelector('.advanced-options-toggle .toggle-icon').textContent = '▲';
                }

                // Auto-connect
                const credentials = {
                    host: data.host || document.getElementById('host').value,
                    port: parseInt(data.port || document.getElementById('port').value),
                    user: data.username,
                    password: data.password,
                    engine: data.engine || 'mysql',
                    ssl: data.ssl || null
                };

                currentCredentials = credentials;
                socket.emit('connect_database', credentials);
                showNotification('Auto-connecting with saved credentials...', 'info');
            } else if (data.username || data.password) {
                // Just fill available data without auto-connecting
                if (data.username) document.getElementById('user').value = data.username;
                if (data.password) document.getElementById('password').value = data.password;
            }
        })
        .catch(error => {
            console.error('Error restoring session credentials:', error);
        });
}

// Handle window resize to update scroll indicators
window.addEventListener('resize', () => {
    // Update scroll indicators for all table containers
    document.querySelectorAll('.table-container').forEach(container => {
        addScrollIndicator(container);
    });
});

// Handle keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
        if (document.activeElement === sqlQuery) {
            executeQuery();
        }
    } else if (e.key === 'Escape') {
        // Close any open modals
        const modals = document.querySelectorAll('.modal');
        modals.forEach(modal => {
            if (modal.style.display === 'block') {
                modal.style.display = 'none';
            }
        });
    }
});


function handleDeleteAllData() {
    if (!currentDatabase || !currentTable) {
        showNotification('No table selected', 'error');
        return;
    }

    if (!confirm(`Are you sure you want to delete ALL data from table '${currentTable}'? This action cannot be undone!`)) {
        return;
    }

    // Double confirmation
    const verify = prompt(`Type 'DELETE' to confirm deleting all data from '${currentTable}':`);
    if (!verify || verify.toUpperCase() !== 'DELETE') {
        showNotification('Deletion cancelled', 'info');
        return;
    }

    socket.emit('delete_all_data', {
        database: currentDatabase,
        table: currentTable
    });
}

function handleDeleteSelectedRows() {
    if (!currentDatabase || !currentTable) {
        showNotification('No table selected', 'error');
        return;
    }

    if (!currentPrimaryKey) {
        showNotification('Cannot delete rows: No Primary Key found', 'error');
        return;
    }

    const selectedCheckboxes = document.querySelectorAll('.row-checkbox:checked');
    if (selectedCheckboxes.length === 0) {
        showNotification('Please select rows to delete', 'error');
        return;
    }

    const ids = Array.from(selectedCheckboxes).map(cb => cb.value);

    if (!confirm(`Are you sure you want to delete ${ids.length} selected row(s)?`)) {
        return;
    }

    socket.emit('delete_selected_data', {
        database: currentDatabase,
        table: currentTable,
        targetColumn: currentPrimaryKey,
        targetValues: ids
    });
}

// Copy functions
function copyRowData(rowData, buttonElement) {
    try {
        // Format row data as JSON
        const jsonData = JSON.stringify(rowData, null, 2);

        // Copy as JSON format only
        navigator.clipboard.writeText(jsonData).then(() => {
            showNotification('Row data copied to clipboard (JSON format)', 'success');
            if (buttonElement) animateCopySuccess(buttonElement);
        }).catch(() => {
            // Fallback for older browsers
            fallbackCopyText(jsonData);
            showNotification('Row data copied to clipboard (JSON format)', 'success');
            if (buttonElement) animateCopySuccess(buttonElement);
        });
    } catch (error) {
        console.error('Copy failed:', error);
        showNotification('Failed to copy row data', 'error');
    }
}

function copyCellData(cellValue, buttonElement) {
    try {
        const textValue = cellValue === null ? 'NULL' : String(cellValue);

        navigator.clipboard.writeText(textValue).then(() => {
            showNotification(`Cell data copied: "${textValue.length > 50 ? textValue.substring(0, 50) + '...' : textValue}"`, 'success');
            if (buttonElement) animateCopySuccess(buttonElement);
        }).catch(() => {
            fallbackCopyText(textValue);
            showNotification(`Cell data copied: "${textValue.length > 50 ? textValue.substring(0, 50) + '...' : textValue}"`, 'success');
            if (buttonElement) animateCopySuccess(buttonElement);
        });
    } catch (error) {
        console.error('Copy failed:', error);
        showNotification('Failed to copy cell data', 'error');
    }
}

function animateCopySuccess(button) {
    if (button) {
        button.classList.add('copy-success');
        setTimeout(() => {
            button.classList.remove('copy-success');
        }, 300);
    }
}

function fallbackCopyText(text) {
    // Fallback method for older browsers
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
        document.execCommand('copy');
    } catch (err) {
        console.error('Fallback copy failed:', err);
    }

    document.body.removeChild(textArea);
}

// Export functionality
function showExportDatabaseModal() {
    if (!currentDatabase) {
        showNotification('Please select a database first', 'error');
        return;
    }

    document.getElementById('exportDbName').textContent = currentDatabase;

    // Load tables for selection
    socket.emit('get_tables', currentDatabase);

    // Show modal after tables are loaded
    setTimeout(() => {
        populateExportTablesList();
        document.getElementById('exportDatabaseModal').style.display = 'block';
    }, 100);
}

function showExportTableModal() {
    if (!currentTable || !currentDatabase) {
        showNotification('Please select a table first', 'error');
        return;
    }

    document.getElementById('exportTableName').textContent = `${currentDatabase}.${currentTable}`;
    document.getElementById('exportTableModal').style.display = 'block';
}

function populateExportTablesList() {
    const container = document.getElementById('exportTablesList');
    container.innerHTML = '';

    // Get tables from the sidebar
    const tableItems = document.querySelectorAll('.table-list li');
    tableItems.forEach(item => {
        const tableName = item.textContent;

        const div = document.createElement('div');
        div.className = 'export-table-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = tableName;
        checkbox.id = `export_table_${tableName}`;
        checkbox.checked = true;

        const label = document.createElement('label');
        label.htmlFor = `export_table_${tableName}`;
        label.textContent = tableName;

        div.appendChild(checkbox);
        div.appendChild(label);
        container.appendChild(div);
    });
}

function selectAllTables() {
    document.querySelectorAll('#exportTablesList input[type="checkbox"]').forEach(cb => {
        cb.checked = true;
    });
}

function deselectAllTables() {
    document.querySelectorAll('#exportTablesList input[type="checkbox"]').forEach(cb => {
        cb.checked = false;
    });
}

function toggleDataExportOptions() {
    const includeData = document.getElementById('exportTableIncludeData').checked;
    const dataOptions = document.getElementById('dataExportOptions');
    dataOptions.style.display = includeData ? 'block' : 'none';
}

function toggleCustomWhereClause() {
    const customRadio = document.querySelector('input[name="dataExportType"][value="custom"]');
    const customDiv = document.getElementById('customWhereClause');
    customDiv.style.display = customRadio.checked ? 'block' : 'none';
}

function previewRowCount() {
    const whereClause = document.getElementById('exportWhereClause').value.trim();
    if (!whereClause) {
        showNotification('Please enter a WHERE clause', 'error');
        return;
    }

    socket.emit('get_row_count', {
        database: currentDatabase,
        table: currentTable,
        whereClause: whereClause
    });
}

function exportDatabase(e) {
    e.preventDefault();

    const includeData = document.getElementById('exportIncludeData').checked;
    const separateData = document.getElementById('exportSeparateData').checked;
    const exportMethod = document.querySelector('input[name="exportMethod"]:checked').value;
    const exportFormat = document.querySelector('input[name="exportFormat"]:checked').value;
    const selectedTables = Array.from(document.querySelectorAll('#exportTablesList input[type="checkbox"]:checked'))
        .map(cb => cb.value);

    if (selectedTables.length === 0) {
        showNotification('Please select at least one table to export', 'error');
        return;
    }

    showNotification('Exporting database... This may take a moment.', 'info');

    socket.emit('export_database', {
        database: currentDatabase,
        options: {
            includeData: includeData,
            separateData: separateData,
            exportMethod: exportMethod,
            selectedTables: selectedTables,
            format: exportFormat
        }
    });
}

function exportTable(e) {
    e.preventDefault();

    const includeData = document.getElementById('exportTableIncludeData').checked;
    const dataExportType = document.querySelector('input[name="dataExportType"]:checked').value;
    const tableExportFormat = document.querySelector('input[name="tableExportFormat"]:checked').value;

    let options = {
        includeData: includeData,
        format: tableExportFormat
    };

    if (includeData) {
        if (dataExportType === 'current') {
            // Use current active search/filter conditions
            options.searchFilters = currentSearchFilters.length > 0 ? currentSearchFilters : null;
            options.searchLogic = currentSearchLogic;
        } else if (dataExportType === 'custom') {
            const customWhere = document.getElementById('exportWhereClause').value.trim();
            if (!customWhere) {
                showNotification('Please enter a WHERE clause or select a different export option', 'error');
                return;
            }
            options.whereClause = customWhere;
        }
        // For 'all', no additional options needed
    }

    showNotification('Exporting table... This may take a moment.', 'info');

    socket.emit('export_table', {
        database: currentDatabase,
        table: currentTable,
        options: options
    });
}

function buildCurrentWhereClause() {
    // Legacy: returns null since we now use searchFilters directly
    return null;
}

function exportSelectedRows() {
    if (!currentDatabase || !currentTable) {
        showNotification('Please select a table first', 'error');
        return;
    }

    if (!currentPrimaryKey) {
        showNotification('Cannot export: no Primary Key found on this table', 'error');
        return;
    }

    const selectedCheckboxes = document.querySelectorAll('.row-checkbox:checked');
    if (selectedCheckboxes.length === 0) {
        showNotification('Please select at least one row to export', 'error');
        return;
    }

    const pkValues = Array.from(selectedCheckboxes).map(cb => cb.value);

    showNotification(`Exporting ${pkValues.length} selected row(s)...`, 'info');

    socket.emit('export_table', {
        database: currentDatabase,
        table: currentTable,
        options: {
            includeData: true,
            format: 'sql',
            selectedPKValues: pkValues,
            pkColumn: currentPrimaryKey
        }
    });
}

function exportCurrentData() {
    if (!currentTable || !currentDatabase) {
        showNotification('Please select a table first', 'error');
        return;
    }

    // Quick export of current filtered data
    let options = {
        includeData: true,
        format: 'sql',
        searchFilters: currentSearchFilters.length > 0 ? currentSearchFilters : null,
        searchLogic: currentSearchLogic
    };

    showNotification('Exporting current data... This may take a moment.', 'info');

    socket.emit('export_table', {
        database: currentDatabase,
        table: currentTable,
        options: options
    });
}

function downloadFile(filename, content, isBinary = false) {
    let blob;
    if (isBinary) {
        // If content is an ArrayBuffer (from socket.io for binary data)
        blob = new Blob([content], { type: 'application/zip' });
    } else {
        blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    }

    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Error Log Functions
function addErrorToLog(data) {
    const logList = document.getElementById('errorLogList');

    const errorItem = document.createElement('div');
    errorItem.className = 'error-log-item';

    const timestamp = new Date().toLocaleTimeString();

    // Meta info
    const metaDiv = document.createElement('div');
    metaDiv.className = 'error-log-meta';
    metaDiv.innerHTML = `
        <span>Database: ${data.database || 'N/A'}</span>
        <span>${timestamp}</span>
    `;

    // Error message
    const messageDiv = document.createElement('div');
    messageDiv.className = 'error-log-message';
    messageDiv.innerHTML = `
        <span class="error-log-message-text">${data.message}</span>
        <button class="copy-btn" onclick="copyToClipboard('${data.message.replace(/'/g, "\\'")}', 'Error copied!')">
            Copy Error
        </button>
    `;

    // Query
    const queryDiv = document.createElement('div');
    queryDiv.className = 'error-log-query';
    queryDiv.innerHTML = `
        <span>${data.query}</span>
        <button class="copy-btn" onclick="copyToClipboard('${data.query.replace(/'/g, "\\'").replace(/\n/g, "\\n")}', 'Query copied!')">
            Copy Query
        </button>
    `;

    errorItem.appendChild(metaDiv);
    errorItem.appendChild(messageDiv);
    errorItem.appendChild(queryDiv);

    // Add to top of list
    if (logList.firstChild) {
        logList.insertBefore(errorItem, logList.firstChild);
    } else {
        logList.appendChild(errorItem);
    }
}

function clearErrorLog() {
    const logList = document.getElementById('errorLogList');
    logList.innerHTML = '';
    document.getElementById('errorLogContainer').style.display = 'none';
}

function copyToClipboard(text, successMessage) {
    navigator.clipboard.writeText(text).then(() => {
        showNotification(successMessage, 'success');
    }).catch(err => {
        console.error('Failed to copy: ', err);
        showNotification('Failed to copy to clipboard', 'error');
    });
}
window.copyToClipboard = copyToClipboard; // Make globally accessible for onclick events

// Global functions for HTML onclick handlers
window.selectAllTables = selectAllTables;
window.deselectAllTables = deselectAllTables;
window.previewRowCount = previewRowCount;
