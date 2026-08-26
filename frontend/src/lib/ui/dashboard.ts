import { escapeHtml } from '../utils';

export function renderDashboardDbSizes(sizes: any[]) {
    const list = document.getElementById('dbSizesList');
    if (!list) return;

    if (!sizes.length) { 
        list.innerHTML = '<div class="text-muted text-sm">No size data available</div>'; 
        return; 
    }

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

export function renderDashboardStatCards(dbCount: number, totalMb: number) {
    const container = document.getElementById('dashboardStats');
    if (!container) return;

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
            <div class="stat-card-label">Tables</div>
        </div>
        <div class="stat-card stat-card-primary">
            <div class="stat-card-icon">💾</div>
            <div class="stat-card-value">${totalMb.toFixed(1)} MB</div>
            <div class="stat-card-label">Total Size</div>
        </div>
    `;
}

export function updateServerInfo(info: any) {
    if (!info) return;
    if (document.getElementById('serverHost')) document.getElementById('serverHost')!.textContent = info.host || 'Unknown';
    if (document.getElementById('serverEngine')) document.getElementById('serverEngine')!.textContent = info.engine || 'Unknown';
    if (document.getElementById('serverCpuCores')) document.getElementById('serverCpuCores')!.textContent = info.cpuCores || 'Unknown';
    if (document.getElementById('serverRam')) document.getElementById('serverRam')!.textContent = info.ram || 'Unknown';
    if (document.getElementById('serverUptime')) document.getElementById('serverUptime')!.textContent = info.uptime || 'Unknown';
    if (document.getElementById('serverPlatform')) document.getElementById('serverPlatform')!.textContent = info.platform || 'Unknown';
}
