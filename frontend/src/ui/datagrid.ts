import { state, notifyStateChanged } from '../state';
import { socket } from '../services/socket';
import { escapeHtml } from '../utils';

// We can export variables that might be needed, or manage them in state.
let _columnMap: string[] = [];

export function renderTableData(dataPayload: { data: any[], total: number, limit: number, offset: number }) {
    const { data, total } = dataPayload;
    state.totalRows = total;
    notifyStateChanged();

    const table = document.getElementById('dataTable');
    if (!table) return;
    
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');
    if (!thead || !tbody) return;

    if (!data || !data.length) {
        thead.innerHTML = '';
        tbody.innerHTML = '<tr><td colspan="99" style="text-align:center;padding:40px;color:var(--text-muted);">No data found</td></tr>';
        updatePaginationInfo(0);
        return;
    }

    const cols = Object.keys(data[0]);
    _columnMap = cols;

    // Build filter column options
    document.querySelectorAll('.filter-column').forEach((sel: any) => {
        const cur = sel.value;
        sel.innerHTML = '<option value="">Column</option>' + cols.map(c => `<option value="${c}" ${c === cur ? 'selected' : ''}>${c}</option>`).join('');
    });

    // Header
    thead.innerHTML = `<tr>
        <th><input type="checkbox" id="selectAllRows" class="row-select-checkbox"></th>
        ${cols.map(c => `<th data-col="${c}" class="${c === state.currentSortColumn ? 'sorted' : ''}">${c}${c === state.currentSortColumn ? `<span class="sort-icon">${state.currentSortDirection === 'ASC' ? '⬆️' : '⬇️'}</span>` : ''}</th>`).join('')}
        <th>Actions</th>
    </tr>`;

    // Sortable headers
    thead.querySelectorAll('th[data-col]').forEach(th => {
        (th as HTMLElement).style.cursor = 'pointer';
        th.addEventListener('click', () => {
            const col = (th as HTMLElement).dataset.col!;
            if (state.currentSortColumn === col) {
                state.currentSortDirection = state.currentSortDirection === 'ASC' ? 'DESC' : 'ASC';
            } else {
                state.currentSortColumn = col;
                state.currentSortDirection = 'ASC';
            }
            notifyStateChanged();
            loadTableData();
        });
    });

    // Select All
    const selectAll = document.getElementById('selectAllRows') as HTMLInputElement;
    if (selectAll) {
        selectAll.addEventListener('change', (e) => {
            const checked = (e.target as HTMLInputElement).checked;
            document.querySelectorAll('.row-select').forEach((cb: any) => cb.checked = checked);
        });
    }

    // Body
    window._rowData = data;
    tbody.innerHTML = data.map((row, i) => `
        <tr data-index="${i}">
            <td><input type="checkbox" class="row-select" value="${i}"></td>
            ${cols.map(c => {
                let val = row[c];
                let display = val;
                if (val === null) display = '<span class="null-value">NULL</span>';
                else if (typeof val === 'object') display = escapeHtml(JSON.stringify(val));
                else display = escapeHtml(String(val));
                
                // Truncate long strings
                if (typeof val === 'string' && val.length > 100) {
                    display = display.substring(0, 100) + '... <span class="text-xs text-muted" title="Hover to see full text">(more)</span>';
                }
                return `<td title="${typeof val === 'string' ? escapeHtml(val) : ''}">${display}</td>`;
            }).join('')}
            <td>
                <div class="table-actions">
                    <button class="btn btn-sm btn-secondary" onclick="window.openEditRowModal(${i})">Edit</button>
                    <button class="btn btn-sm btn-danger" onclick="window.deleteRow(${i})">Del</button>
                </div>
            </td>
        </tr>
    `).join('');

    updatePaginationInfo(data.length);
}

export function loadTableData() {
    if (!state.currentDatabase || !state.currentTable) return;
    const offset = (state.currentPage - 1) * state.pageSize;
    const filters = window.collectFilters ? window.collectFilters() : [];
    socket.emit('get_table_data', {
        database: state.currentDatabase,
        table: state.currentTable,
        limit: state.pageSize,
        offset,
        sortColumn: state.currentSortColumn,
        sortDirection: state.currentSortDirection,
        searchFilters: filters.length ? filters : null,
        searchLogic: state.currentSearchLogic
    });
}

function updatePaginationInfo(currentCount: number) {
    const info = document.getElementById('paginationInfo');
    if (info) {
        if (state.totalRows === 0) {
            info.textContent = '0 - 0 of 0';
        } else {
            const start = (state.currentPage - 1) * state.pageSize + 1;
            const end = start + currentCount - 1;
            info.textContent = `${start} - ${end} of ${state.totalRows.toLocaleString()}`;
        }
    }
}
