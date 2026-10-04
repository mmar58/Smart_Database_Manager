<script lang="ts">
    import { Database, Table, ChevronRight, ChevronDown, Trash2, Download, Upload, Copy } from "@lucide/svelte";
    import ContextMenu from "./ContextMenu.svelte";
    import ExportModal from "./ExportModal.svelte";
    import { appState } from "$lib/state.svelte";
    import { socket } from "$lib/services/socket";

    // Since we're using Svelte, we can keep track of expanded states locally
    let expandedDbs = $state<Record<string, boolean>>({});

    // We expect the backend to send the DBs list and we can store it in state or local
    let databases = $state<string[]>([]);
    let dbTables = $state<Record<string, string[]>>({});

    let contextMenu = $state<{
        show: boolean;
        x: number;
        y: number;
        options: any[];
    }>({ show: false, x: 0, y: 0, options: [] });

    let fileInput: HTMLInputElement;
    let importTarget = $state<{ type: 'database' | 'table', db: string, table?: string } | null>(null);

    let showExportModal = $state(false);
    let exportDatabaseTarget = $state("");
    let exportTableTarget = $state<string | null>(null);

    $effect(() => {
        // Request databases on mount
        if (appState.isConnected && appState.currentCredentials) {
            socket.emit("get_databases");
        }

        // Listen for database list
        socket.on("databases_list", (dbs: string[]) => {
            databases = dbs;
        });

        socket.on(
            "tables_list",
            (data: { database: string; tables: string[] }) => {
                dbTables[data.database] = data.tables;
            },
        );

        socket.on("database_exported", (data) => {
            downloadFile(data.filename, data.content);
        });

        socket.on("table_exported", (data) => {
            downloadFile(data.filename, data.content);
        });

        // Trigger reload on DB/Table changes
        socket.on("database_dropped", () => socket.emit("get_databases"));
        socket.on("table_dropped", (data) => {
            if (data?.database) socket.emit("get_tables", data.database);
            else if (appState.currentDatabase) socket.emit("get_tables", appState.currentDatabase);
        });
        socket.on("database_duplicated", () => socket.emit("get_databases"));
        socket.on("table_duplicated", () => {
            if (appState.currentDatabase) socket.emit("get_tables", appState.currentDatabase);
        });
        socket.on("database_imported", (data) => {
            socket.emit("get_databases");
            if (data?.database) {
                socket.emit("get_tables", data.database);
            } else if (appState.currentDatabase) {
                socket.emit("get_tables", appState.currentDatabase);
            }
        });
        socket.on("table_imported", (data) => {
            if (data?.database) {
                socket.emit("get_tables", data.database);
            } else if (appState.currentDatabase) {
                socket.emit("get_tables", appState.currentDatabase);
            }
        });

        return () => {
            socket.off("databases_list");
            socket.off("tables_list");
            socket.off("database_exported");
            socket.off("table_exported");
            socket.off("database_dropped");
            socket.off("table_dropped");
            socket.off("database_duplicated");
            socket.off("table_duplicated");
            socket.off("database_imported");
            socket.off("table_imported");
        };
    });

    function downloadFile(filename: string, content: string) {
        const blob = new Blob([content], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function toggleDb(db: string) {
        appState.currentDatabase = db;
        appState.currentTable = null;
        appState.activeTab = 'dashboard';
        expandedDbs[db] = !expandedDbs[db];
        if (expandedDbs[db] && !dbTables[db]) {
            socket.emit("get_tables", db);
        }
    }

    function selectTable(db: string, table: string) {
        appState.currentDatabase = db;
        appState.currentTable = table;
        if (appState.activeTab === 'dashboard') {
            appState.activeTab = 'data';
        }
        appState.currentPage = 1;
        appState.currentSearchFilters = [];
        appState.currentSortColumn = null;
        appState.currentSortDirection = "ASC";

        socket.emit("get_table_structure", { database: db, table });

        const offset = (appState.currentPage - 1) * appState.pageSize;
        socket.emit("get_table_data", {
            database: db,
            table,
            limit: appState.pageSize,
            offset,
            sortColumn: appState.currentSortColumn,
            sortDirection: appState.currentSortDirection,
            searchFilters: null,
            searchLogic: appState.currentSearchLogic,
        });
    }
</script>

<div class="flex flex-col gap-1 w-full text-sm">

    {#each databases as db}
        <div class="flex flex-col group">
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
                class="flex items-center gap-2 p-2 hover:bg-secondary cursor-pointer rounded-md {appState.currentDatabase ===
                    db && !appState.currentTable
                    ? 'bg-secondary text-primary font-medium'
                    : ''}"
                onclick={() => toggleDb(db)}
            >
                <button class="p-0.5 hover:bg-muted rounded">
                    {#if expandedDbs[db]}
                        <ChevronDown size={14} class="text-muted-foreground" />
                    {:else}
                        <ChevronRight size={14} class="text-muted-foreground" />
                    {/if}
                </button>
                <Database size={16} class="text-primary" />
                <span class="truncate">{db}</span>
            </div>

            {#if expandedDbs[db] && dbTables[db]}
                <div
                    class="flex flex-col ml-6 border-l border-border pl-2 gap-1 mt-1"
                >
                    {#if dbTables[db].length === 0}
                        <div class="text-muted-foreground text-xs p-1 italic">
                            No tables
                        </div>
                    {/if}

                    {#each dbTables[db] as table}
                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                        <!-- svelte-ignore a11y_no_static_element_interactions -->
                        <div
                            class="flex items-center gap-2 p-1.5 hover:bg-secondary cursor-pointer rounded-md {appState.currentDatabase ===
                                db && appState.currentTable === table
                                ? 'bg-secondary text-primary font-medium'
                                : 'text-muted-foreground hover:text-foreground'}"
                            onclick={() => selectTable(db, table)}
                        >
                            <Table size={14} />
                            <span class="truncate text-xs">{table}</span>
                        </div>
                    {/each}
                </div>
            {/if}
        </div>
    {/each}
</div>

{#if contextMenu.show}
    <ContextMenu
        x={contextMenu.x}
        y={contextMenu.y}
        options={contextMenu.options}
        onClose={() => (contextMenu.show = false)}
    />
{/if}
