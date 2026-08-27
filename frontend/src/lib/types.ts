export interface ServerConnection {
    host: string;
    port: number;
    user: string;
    password?: string;
    database?: string;
    engine: 'mysql' | 'postgresql';
    sslCa?: string;
    sslCert?: string;
    sslKey?: string;
    rejectUnauthorized?: boolean;
    _id?: string;
    _location?: 'server' | 'local';
    ipRestriction?: 'current' | 'all' | 'selected';
    selectedIps?: string[];
    savedIp?: string;
}

export interface TableColumn {
    Field: string;
    Type: string;
    Null: string;
    Key: string;
    Default: string | null;
    Extra: string;
}

export interface TableIndex {
    Key_name: string;
    Column_name: string;
    Non_unique: number;
    Index_type: string;
    Cardinality: number;
}

export interface RowData {
    [key: string]: any;
}

export interface FilterConfig {
    column: string;
    operator: string;
    value: string;
}

export interface AppSettings {
    theme?: 'light' | 'dark';
    ollamaApiUrl?: string;
    ollamaModel?: string;
    [key: string]: any;
}

export interface OllamaMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    action?: string; // used for logging tool calls
}

export interface OllamaChatSession {
    id: string;
    title: string;
    messages: OllamaMessage[];
    updatedAt: number;
}

export interface OllamaAssistantState {
    isOpen: boolean;
    layout: 'floating' | 'sidebar';
    sessions: OllamaChatSession[];
    currentSessionId: string | null;
}

export interface BackupProfile {
    id: string;
    name: string;
    database: string;
    schedule: string;
    tables: string[];
    format: 'sql' | 'json';
    includeData: boolean;
    lastRun?: string;
    status?: string;
}

export interface SystemStats {
    cpu: number;
    memory: {
        total: number;
        free: number;
        used: number;
        usedPercentage: number;
    };
    uptime: number;
    platform: string;
}

export interface ERTable {
    name: string;
    columns: TableColumn[];
    x: number;
    y: number;
}

export interface ERForeignKey {
    TABLE_NAME: string;
    COLUMN_NAME: string;
    REFERENCED_TABLE_NAME: string;
    REFERENCED_COLUMN_NAME: string;
}

declare global {
    interface Window {
        dbAction: (action: string, db: string, event?: Event) => void;
        tableAction: (action: string, db: string, table: string, event?: Event) => void;
        showContextMenu: (x: number, y: number, items: any[]) => void;
        openAnnotationModal: (db: string, table: string) => void;
        openInsertRowModal: () => void;
        selectTable: (db: string, table: string, element?: HTMLElement) => void;
        updateAnnotationIcons: () => void;
        _allSavedConnections?: ServerConnection[];
        _rowData?: any[];
    }
}
