import type {
    ServerConnection,
    TableColumn,
    FilterConfig,
    AppSettings,
    BackupProfile
} from './types';

// Encapsulated Application State using Svelte 5 Runes
export const appState = $state({
    currentDatabase: null as string | null,
    currentTable: null as string | null,
    currentTableStructure: null as TableColumn[] | null,
    currentCredentials: null as ServerConnection | null,
    isConnected: false,
    activeTab: 'dashboard' as 'dashboard' | 'data' | 'structure' | 'indexes' | 'query' | 'er' | 'slowqueries',
    databases: [] as string[],
    theme: 'dark' as 'light' | 'dark',
    sidebarWidth: 250,
    sqlEditor: null as any,
    totalRows: 0,
    currentPage: 1,
    pageSize: 50,
    currentSortColumn: null as string | null,
    currentSortDirection: 'ASC' as 'ASC' | 'DESC',
    currentSearchFilters: [] as FilterConfig[],
    currentSearchLogic: 'AND' as 'AND' | 'OR',

    // App Data
    annotations: {} as Record<string, string>,
    settings: {
        theme: 'dark',
        ollamaApiUrl: 'http://localhost:11434',
        ollamaModel: ''
    } as AppSettings,
});

export function initSettings() {
    try {
        const saved = localStorage.getItem('appSettings');
        if (saved) {
            const parsed = JSON.parse(saved);
            appState.settings = { ...appState.settings, ...parsed };
            appState.theme = appState.settings.theme || 'dark';
        }
    } catch (e) {
        console.error('Error loading settings', e);
    }
}

export function saveSettings(newSettings: Partial<AppSettings>) {
    appState.settings = { ...appState.settings, ...newSettings };
    if (newSettings.theme) appState.theme = newSettings.theme;
    localStorage.setItem('appSettings', JSON.stringify(appState.settings));
}

export function notifyStateChanged() {
    // No-op in Svelte 5 since $state is deeply reactive!
}
