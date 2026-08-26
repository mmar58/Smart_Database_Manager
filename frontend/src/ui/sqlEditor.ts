import { state, notifyStateChanged } from '../state';
import { socket } from '../services/socket';
import { showNotification } from '../utils'; // Assuming this gets moved or we can use console.log

export function initCodeMirror() {
    const textarea = document.getElementById('sqlQuery') as HTMLTextAreaElement;
    if (!textarea || state.sqlEditor) return;

    const theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dracula' : 'default';
    
    // We assume CodeMirror is available globally from CDN
    const cm = (window as any).CodeMirror;
    if (!cm) return;

    state.sqlEditor = cm.fromTextArea(textarea, {
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
    
    state.sqlEditor.setSize('100%', '210px');
    notifyStateChanged();
}

export function executeQuery() {
    const query = state.sqlEditor ? state.sqlEditor.getValue().trim() : (document.getElementById('sqlQuery') as HTMLTextAreaElement)?.value.trim();
    const dbInput = document.getElementById('queryDatabase') as HTMLSelectElement;
    const db = dbInput ? dbInput.value : state.currentDatabase;

    if (!query) {
        if ((window as any).showNotification) (window as any).showNotification('Query is empty', 'warning');
        return;
    }
    if (!db) {
        if ((window as any).showNotification) (window as any).showNotification('Select a database', 'warning');
        return;
    }

    socket.emit('save_query_history', { query, database: db });
    const start = Date.now();
    socket.emit('execute_query', { database: db, query });

    socket.once('query_result', () => {
        const timeEl = document.getElementById('queryExecTime');
        if (timeEl) timeEl.textContent = `${Date.now() - start}ms`;
    });
}
