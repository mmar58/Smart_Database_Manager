import type {
    ServerConnection,
    TableColumn,
    FilterConfig,
    AppSettings,
    BackupProfile
} from './types';

// Encapsulated Application State
export const state = {
    currentDatabase: null as string | null,
    currentTable: null as string | null,
    currentTableStructure: null as TableColumn[] | null,
    currentCredentials: null as ServerConnection | null,
    isConnected: false,
    
    // Pagination & Data Grid State
    currentPage: 1,
    pageSize: 100,
    currentSortColumn: null as string | null,
    currentSortDirection: 'ASC' as 'ASC' | 'DESC',
    currentSearchFilters: [] as FilterConfig[],
    currentSearchLogic: 'AND' as 'AND' | 'OR',
    totalRows: 0,
    
    // App Data
    annotations: {} as Record<string, string>,
    settings: {} as AppSettings,
    backupProfiles: [] as BackupProfile[],
    
    // Editor State
    sqlEditor: null as any // CodeMirror instance
};

// State Change Listeners (Optional but useful for reacting to state changes)
type Listener = () => void;
const listeners: Listener[] = [];

export function subscribe(listener: Listener) {
    listeners.push(listener);
    return () => {
        const idx = listeners.indexOf(listener);
        if (idx > -1) listeners.splice(idx, 1);
    };
}

export function notifyStateChanged() {
    listeners.forEach(l => l());
}
