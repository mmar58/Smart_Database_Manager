<script lang="ts">
    import { appState } from "$lib/state.svelte";
    import { Settings, Download, Upload, Copy, Trash2, Database, Table2, Server, MoreHorizontal } from "@lucide/svelte";
    import { socket } from "$lib/services/socket";
    import { onMount } from "svelte";
    import ExportModal from "./ExportModal.svelte";
    import ImportModal from "./ImportModal.svelte";

    // Modals
    let showExportModal = $state(false);
    let showImportModal = $state(false);
    let showMoreMenu = $state(false);
    let moreMenuRef: HTMLDivElement | null = $state(null);

    // Derived current level
    let currentLevel = $derived(
        appState.currentTable ? 'table' : 
        appState.currentDatabase ? 'database' : 'server'
    );

    // Action handlers
    function duplicateDatabase(db: string) { 
        const newName = prompt(`Enter new name for database '${db}':`);
        if (newName && newName !== db) socket.emit("duplicate_database", { database: db, newDatabase: newName });
    }
    function dropDatabase(db: string) { 
        if(confirm(`Drop database '${db}'? This cannot be undone.`)) {
            socket.emit("drop_database", db);
            appState.currentDatabase = null;
            appState.currentTable = null;
        }
    }
    function duplicateTable(db: string, table: string) { 
        const newName = prompt(`Enter new name for table '${table}':`);
        if (newName && newName !== table) socket.emit("duplicate_table", { database: db, table, newTable: newName });
    }
    function truncateTable(db: string, table: string) { 
        if(confirm(`Empty all data in '${table}'?`)) socket.emit("truncate_table", { database: db, table }); 
    }
    function dropTable(db: string, table: string) { 
        if(confirm(`Drop table '${table}'? This cannot be undone.`)) {
            socket.emit("drop_table", { database: db, table });
            appState.currentTable = null;
        }
    }

    function handleExport(level: 'server' | 'database' | 'table', db: string | null, tbl: string | null, options: any) {
        if (level === 'server') {
            socket.emit("export_server", { options }); 
        } else if (level === 'table' && db && tbl) {
            socket.emit("export_table", { database: db, table: tbl, options });
        } else if (level === 'database' && db) {
            socket.emit("export_database", { database: db, options });
        }
    }

    // Dynamic Actions
    let actions = $derived.by(() => {
        const base = [
            { label: 'Export', icon: Download, class: '', action: () => showExportModal = true },
            { label: 'Import', icon: Upload, class: '', action: () => showImportModal = true }
        ];

        if (currentLevel === 'table') {
            return [
                ...base,
                { label: 'Duplicate', icon: Copy, class: '', action: () => duplicateTable(appState.currentDatabase!, appState.currentTable!) },
                { label: 'Empty', icon: Trash2, class: 'text-destructive hover:bg-destructive/10 hover:text-destructive', action: () => truncateTable(appState.currentDatabase!, appState.currentTable!) },
                { label: 'Drop', icon: Trash2, class: 'text-destructive hover:bg-destructive/10 hover:text-destructive', action: () => dropTable(appState.currentDatabase!, appState.currentTable!) }
            ];
        } else if (currentLevel === 'database') {
            return [
                ...base,
                { label: 'Duplicate', icon: Copy, class: '', action: () => duplicateDatabase(appState.currentDatabase!) },
                { label: 'Drop', icon: Trash2, class: 'text-destructive hover:bg-destructive/10 hover:text-destructive', action: () => dropDatabase(appState.currentDatabase!) }
            ];
        }
        return base;
    });

    // Responsive toolbar logic
    let containerWidth = $state(0);
    // Assume average button width is ~95px, "more" button is ~40px.
    let maxVisibleItems = $derived(
        containerWidth === 0 ? actions.length : // Initial render, show all or rely on overflow hidden
        Math.max(0, Math.floor((containerWidth - 48) / 95)) // 48px is enough for the "..." button
    );

    let visibleActions = $derived(
        actions.length <= Math.floor(containerWidth / 95) ? actions : actions.slice(0, maxVisibleItems)
    );
    let overflowActions = $derived(
        actions.length <= Math.floor(containerWidth / 95) ? [] : actions.slice(maxVisibleItems)
    );

    // Close on click outside
    function handleClickOutside(event: MouseEvent) {
        if (showMoreMenu && moreMenuRef && !moreMenuRef.contains(event.target as Node)) {
            showMoreMenu = false;
        }
    }

    onMount(() => {
        document.addEventListener('click', handleClickOutside);
        return () => document.removeEventListener('click', handleClickOutside);
    });
</script>

<div class="flex items-center justify-center w-full min-w-0 h-full" bind:clientWidth={containerWidth}>
    <div class="flex items-center gap-1" style="max-width: 100%;">
        {#each visibleActions as action}
            <button 
                class="flex items-center gap-1.5 px-2.5 py-1.5 bg-secondary/30 hover:bg-secondary text-secondary-foreground rounded-md text-xs font-medium transition-colors whitespace-nowrap flex-shrink-0 {action.class}"
                onclick={(e) => { e.stopPropagation(); action.action(); }}
                title={action.label}
            >
                <action.icon size={14} />
                <span>{action.label}</span>
            </button>
        {/each}

        {#if overflowActions.length > 0}
            <div class="relative flex-shrink-0" bind:this={moreMenuRef}>
                <button 
                    class="flex items-center justify-center w-8 h-7 bg-secondary/30 hover:bg-secondary text-secondary-foreground rounded-md transition-colors"
                    onclick={(e) => { e.stopPropagation(); showMoreMenu = !showMoreMenu; }}
                    title="More Options"
                >
                    <MoreHorizontal size={14} />
                </button>

                {#if showMoreMenu}
                    <div class="absolute top-full right-0 mt-1 w-40 bg-card border rounded-md shadow-lg z-50 py-1 text-sm">
                        {#each overflowActions as action}
                            <button 
                                class="w-full text-left px-3 py-2 hover:bg-muted transition-colors flex items-center gap-2 {action.class}" 
                                onclick={(e) => { e.stopPropagation(); action.action(); showMoreMenu = false; }}
                            >
                                <action.icon size={14} />
                                <span>{action.label}</span>
                            </button>
                        {/each}
                    </div>
                {/if}
            </div>
        {/if}
    </div>
</div>

<ExportModal 
    show={showExportModal} 
    initialDatabase={appState.currentDatabase}
    initialTable={appState.currentTable}
    onClose={() => showExportModal = false}
    onExport={handleExport}
/>

{#if showImportModal}
<ImportModal
    show={showImportModal}
    onClose={() => showImportModal = false}
/>
{/if}
