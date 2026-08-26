import { state, notifyStateChanged } from '../state';
import { socket } from '../services/socket';
// We will need to import these eventually from their respective modules
// import { dbAction, showContextMenu, tableAction, openAnnotationModal, openInsertRowModal, selectTable, updateAnnotationIcons } from '../app';

export function clearSidebar() {
    const sidebarTree = document.getElementById('sidebarTree');
    const sidebarEmpty = document.getElementById('sidebarEmpty');
    if (!sidebarTree || !sidebarEmpty) return;
    
    sidebarTree.innerHTML = '';
    sidebarEmpty.style.display = 'block';
    sidebarTree.appendChild(sidebarEmpty);
}

export function renderSidebarDatabases(databases: string[]) {
    const sidebarTree = document.getElementById('sidebarTree');
    const sidebarEmpty = document.getElementById('sidebarEmpty');
    if (!sidebarTree || !sidebarEmpty) return;

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
        const firstNode = sidebarTree.querySelector('.db-node') as HTMLElement;
        if (firstNode) expandDb(firstNode, databases[0]);
    }
}

export function createDbNode(db: string): HTMLElement {
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
                <button class="db-action-btn" title="Export" onclick="window.dbAction('export','${db}',event)">📤</button>
                <button class="db-action-btn" title="Import" onclick="window.dbAction('import','${db}',event)">📥</button>
                <button class="db-action-btn" title="Backup now" onclick="window.dbAction('backup','${db}',event)">💾</button>
                <button class="db-action-btn" title="Schema diff" onclick="window.dbAction('diff','${db}',event)">⚖️</button>
                <button class="db-action-btn" title="Drop database" onclick="window.dbAction('drop','${db}',event)" style="color:var(--danger)">🗑️</button>
            </div>
        </div>
        <div class="db-tables" id="dbtables-${db}">
            <div class="sidebar-empty" style="padding:8px 20px;font-size:11.5px;">Loading...</div>
        </div>
    `;

    const header = node.querySelector('.db-node-header') as HTMLElement;
    header.addEventListener('click', () => {
        if (node.classList.contains('open')) {
            collapseDb(node, db);
        } else {
            expandDb(node, db);
        }
    });

    header.addEventListener('contextmenu', (e: MouseEvent) => {
        e.preventDefault();
        if (window.showContextMenu) {
            window.showContextMenu(e.clientX, e.clientY, [
                { icon: '📋', label: `Copy "${db}"`, action: () => navigator.clipboard.writeText(db) },
                { type: 'sep' },
                { icon: '📤', label: 'Export Database', action: () => window.dbAction('export', db) },
                { icon: '📥', label: 'Import into Database', action: () => window.dbAction('import', db) },
                { icon: '💾', label: 'Manual Backup', action: () => window.dbAction('backup', db) },
                { icon: '⚖️', label: 'Schema Diff', action: () => window.dbAction('diff', db) },
                { type: 'sep' },
                { icon: '🗑️', label: 'Drop Database', danger: true, action: () => window.dbAction('drop', db) },
            ]);
        }
    });

    return node;
}

export function expandDb(node: HTMLElement, db: string) {
    node.classList.add('open');
    state.currentDatabase = db;
    notifyStateChanged();
    socket.emit('get_tables', db);
    socket.emit('get_table_sizes', db);
    updateDbHighlight();
}

export function collapseDb(node: HTMLElement, db: string) {
    node.classList.remove('open');
}

export function updateDbHighlight() {
    document.querySelectorAll('.db-node-header').forEach(h => {
        const closestNode = h.closest('.db-node') as HTMLElement;
        if (closestNode) {
            h.classList.toggle('active', closestNode.dataset.db === state.currentDatabase);
        }
    });
}

export function renderSidebarTables(database: string, tables: string[]) {
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
                <button class="table-action-btn" title="Export" onclick="window.tableAction('export','${database}','${table}',event)">📤</button>
                <button class="table-action-btn" title="Note" onclick="window.tableAction('note','${database}','${table}',event)">📝</button>
                <button class="table-action-btn" title="Drop" onclick="window.tableAction('drop','${database}','${table}',event)" style="color:var(--danger)">🗑️</button>
            </div>
        `;

        div.addEventListener('click', (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (target.closest('.table-actions') || target.closest('.table-note-icon')) return;
            if (window.selectTable) window.selectTable(database, table, div);
        });

        div.addEventListener('contextmenu', (e: MouseEvent) => {
            e.preventDefault();
            if (window.showContextMenu) {
                window.showContextMenu(e.clientX, e.clientY, [
                    { icon: '📋', label: `Copy "${table}"`, action: () => navigator.clipboard.writeText(table) },
                    { type: 'sep' },
                    { icon: '📤', label: 'Export Table', action: () => window.tableAction('export', database, table) },
                    { icon: '📝', label: 'Add/Edit Note', action: () => window.openAnnotationModal(database, table) },
                    { icon: '+ Row', label: 'Insert Row', action: () => window.openInsertRowModal() },
                    { type: 'sep' },
                    { icon: '🗑️', label: 'Drop Table', danger: true, action: () => window.tableAction('drop', database, table) },
                ]);
            }
        });

        container.appendChild(div);
    });

    // Restore annotation icons
    if (window.updateAnnotationIcons) window.updateAnnotationIcons();
}
