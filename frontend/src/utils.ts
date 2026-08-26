export function escapeHtml(unsafe: string | null | undefined): string {
    if (unsafe === null || unsafe === undefined) return '';
    return String(unsafe)
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

export function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
}

export function downloadFile(filename: string, content: any, isZip: boolean = false) {
    const mimeType = isZip ? 'application/zip' : filename.endsWith('.json') ? 'application/json' : 'text/plain';
    let blob: Blob;
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

export function formatDate(dateString: string): string {
    if (!dateString) return 'N/A';
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return dateString;
    return d.toLocaleString();
}

export function showNotification(message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info', duration: number = 4000) {
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const container = document.getElementById('notifications');
    if (!container) return;
    const n = document.createElement('div');
    n.className = `notification ${type}`;
    n.innerHTML = `<span class="notification-icon">${icons[type] || 'ℹ️'}</span><span class="notification-text">${message}</span>`;
    container.appendChild(n);
    setTimeout(() => {
        n.classList.add('hiding');
        setTimeout(() => n.remove(), 350);
    }, duration);
}
