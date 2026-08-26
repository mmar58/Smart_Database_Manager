<script lang="ts">
    import { Database, Table, ChevronRight, ChevronDown } from "@lucide/svelte";
    import { appState } from "$lib/state.svelte";
    import { socket } from "$lib/services/socket";

    // Since we're using Svelte, we can keep track of expanded states locally
    let expandedDbs = $state<Record<string, boolean>>({});

    // We expect the backend to send the DBs list and we can store it in state or local
    let databases = $state<string[]>([]);
    let dbTables = $state<Record<string, string[]>>({});

    $effect(() => {
        // Request databases on mount
        if (appState.isConnected && appState.currentCredentials) {
            socket.emit("get_databases");
        }

        // Listen for database list
        socket.on("databases_list", (dbs: string[]) => {
            databases = dbs;
        });

        // Listen for tables list
        socket.on(
            "tables_list",
            (data: { database: string; tables: string[] }) => {
                dbTables[data.database] = data.tables;
            },
        );

        return () => {
            socket.off("databases_list");
            socket.off("tables_list");
        };
    });

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
        <div class="flex flex-col">
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
