import { escapeHtml } from '../utils';

export function renderStructureTable(structure: any[]) {
    const table = document.getElementById('structureTable');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;

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

export function renderIndexesTable(indexes: any[]) {
    const table = document.getElementById('indexesTable');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;

    tbody.innerHTML = (indexes || []).map(idx => `
        <tr>
            <td><strong>${escapeHtml(idx.Key_name || idx.indexname || '')}</strong></td>
            <td><code>${escapeHtml(idx.Column_name || idx.column_name || '')}</code></td>
            <td><span class="badge ${idx.Non_unique === 0 ? 'badge-success' : 'badge-muted'}">${idx.Non_unique === 0 ? 'Yes' : 'No'}</span></td>
            <td class="text-muted">${escapeHtml(idx.Index_type || idx.indexdef?.split(' ')[0] || '')}</td>
            <td class="text-muted">${idx.Cardinality || '-'}</td>
        </tr>
    `).join('');
}
