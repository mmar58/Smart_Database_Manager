<script lang="ts">
    import { onMount } from "svelte";
    import { socket } from "$lib/services/socket";
    import { appState } from "$lib/state.svelte";
    import { Settings, Plus, Trash2, Edit2, Play, Hash } from "@lucide/svelte";
    import type { TableColumn } from "$lib/types";

    let structure = $state<TableColumn[]>([]);
    
    // Alter table states
    let activeSection = $state<"addCol" | "dropCol" | "modifyCol" | "addIndex" | "customAlter">("addCol");
    
    // Add Col
    let newColumnName = $state("");
    let newColumnType = $state("");
    let newColumnDefault = $state("");
    let newColumnPosition = $state("LAST");
    let newColumnNull = $state(false);

    // Inline Edit State
    let editingColumn = $state<string | null>(null);
    let editField = $state("");
    let editType = $state("");
    let editDefault = $state("");
    let editNull = $state(false);

    $effect(() => {
        // Trigger structure fetch when table changes
        if (appState.currentDatabase && appState.currentTable) {
            socket.emit("get_table_structure", { 
                database: appState.currentDatabase, 
                table: appState.currentTable 
            });
        }
    });

    onMount(() => {
        socket.on("table_structure", (data: { database: string; table: string; structure: TableColumn[] }) => {
            if (data.database === appState.currentDatabase && data.table === appState.currentTable) {
                structure = data.structure || [];
            }
        });

        return () => {
            socket.off("table_structure");
        };
    });

    function refreshStructure() {
        if (appState.currentDatabase && appState.currentTable) {
            socket.emit("get_table_structure", { 
                database: appState.currentDatabase, 
                table: appState.currentTable 
            });
        }
    }

    // A helper to submit alter queries
    function executeAlter(query: string) {
        if (!appState.currentDatabase) return;
        socket.emit("execute_query", { database: appState.currentDatabase, query });
        // Refresh after short delay assuming success
        setTimeout(refreshStructure, 500);
    }

    function handleAddColumn(e: Event) {
        e.preventDefault();
        if (!newColumnName || !newColumnType || !appState.currentTable) return;
        
        let query = `ALTER TABLE \`${appState.currentTable}\` ADD COLUMN \`${newColumnName}\` ${newColumnType}`;
        if (!newColumnNull) query += " NOT NULL";
        if (newColumnDefault) query += ` DEFAULT '${newColumnDefault}'`;
        if (newColumnPosition === "FIRST") query += " FIRST";
        
        executeAlter(query);
    }

    function handleDropInline(colName: string) {
        if (!appState.currentTable) return;
        if (!confirm(`Drop column ${colName}? This action cannot be undone and may cause data loss.`)) return;
        
        const query = `ALTER TABLE \`${appState.currentTable}\` DROP COLUMN \`${colName}\``;
        executeAlter(query);
    }

    function startEditing(col: TableColumn) {
        editingColumn = col.Field;
        editField = col.Field;
        // Basic extraction of type, this might need better parsing for complex types
        editType = col.Type.toUpperCase();
        editDefault = col.Default || "";
        editNull = col.Null === "YES";
    }

    function cancelEditing() {
        editingColumn = null;
    }

    function saveEditing() {
        if (!editingColumn || !editField || !editType || !appState.currentTable) return;
        
        let query = `ALTER TABLE \`${appState.currentTable}\` CHANGE COLUMN \`${editingColumn}\` \`${editField}\` ${editType}`;
        if (!editNull) query += " NOT NULL";
        if (editDefault) query += ` DEFAULT '${editDefault}'`;
        
        executeAlter(query);
        editingColumn = null;
    }
</script>

<div class="flex flex-col h-full bg-background overflow-hidden relative">
    <div class="flex-1 overflow-auto p-4">
        <div class="mb-6 border rounded-lg overflow-hidden">
            <div class="flex items-center justify-between p-3 bg-muted/30 border-b">
                <h3 class="font-semibold flex items-center gap-2">
                    <Settings class="w-4 h-4 text-primary" />
                    Table Structure
                </h3>
            </div>
            <div class="overflow-x-auto">
                <table class="w-full text-sm text-left">
                    <thead class="text-xs uppercase bg-muted text-muted-foreground">
                        <tr>
                            <th class="px-4 py-3 border-b">Field</th>
                            <th class="px-4 py-3 border-b">Type</th>
                            <th class="px-4 py-3 border-b">Null</th>
                            <th class="px-4 py-3 border-b">Key</th>
                            <th class="px-4 py-3 border-b">Default</th>
                            <th class="px-4 py-3 border-b">Extra</th>
                            <th class="px-4 py-3 border-b w-[100px]">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {#each structure as col}
                            <tr class="border-b hover:bg-muted/50 transition-colors">
                                {#if editingColumn === col.Field}
                                    <td class="px-2 py-2">
                                        <input type="text" bind:value={editField} class="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs" />
                                    </td>
                                    <td class="px-2 py-2">
                                        <input type="text" bind:value={editType} class="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs font-mono" />
                                    </td>
                                    <td class="px-2 py-2 text-center">
                                        <input type="checkbox" bind:checked={editNull} class="rounded border-input text-primary" />
                                    </td>
                                    <td class="px-4 py-3 font-medium text-primary">{col.Key}</td>
                                    <td class="px-2 py-2">
                                        <input type="text" bind:value={editDefault} class="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs" placeholder="NULL" />
                                    </td>
                                    <td class="px-4 py-3 text-muted-foreground">{col.Extra}</td>
                                    <td class="px-2 py-2 flex items-center gap-1">
                                        <button onclick={saveEditing} class="p-1.5 bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground rounded transition-colors" title="Save">
                                            <Settings class="w-4 h-4" /> <!-- Using settings as check for now, can change icon -->
                                        </button>
                                        <button onclick={cancelEditing} class="p-1.5 bg-muted text-muted-foreground hover:bg-destructive hover:text-destructive-foreground rounded transition-colors" title="Cancel">
                                            <Trash2 class="w-4 h-4" />
                                        </button>
                                    </td>
                                {:else}
                                    <td class="px-4 py-3 font-medium">{col.Field}</td>
                                    <td class="px-4 py-3 font-mono text-muted-foreground">{col.Type}</td>
                                    <td class="px-4 py-3">{col.Null}</td>
                                    <td class="px-4 py-3 font-medium text-primary">{col.Key}</td>
                                    <td class="px-4 py-3 text-muted-foreground">{col.Default === null ? 'NULL' : col.Default}</td>
                                    <td class="px-4 py-3 text-muted-foreground">{col.Extra}</td>
                                    <td class="px-4 py-3 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity" style="opacity: 1">
                                        <button onclick={() => startEditing(col)} class="p-1 text-muted-foreground hover:text-primary transition-colors" title="Edit">
                                            <Edit2 class="w-4 h-4" />
                                        </button>
                                        <button onclick={() => handleDropInline(col.Field)} class="p-1 text-muted-foreground hover:text-destructive transition-colors" title="Drop">
                                            <Trash2 class="w-4 h-4" />
                                        </button>
                                    </td>
                                {/if}
                            </tr>
                        {/each}
                        {#if structure.length === 0}
                            <tr>
                                <td colspan="7" class="px-4 py-8 text-center text-muted-foreground">
                                    Loading structure...
                                </td>
                            </tr>
                        {/if}
                    </tbody>
                </table>
            </div>
        </div>

        <div class="border rounded-lg overflow-hidden bg-card shadow-sm">
            <div class="flex items-center p-2 bg-muted/50 border-b gap-2">
                <button 
                    class="px-3 py-1.5 text-sm font-medium rounded-md transition-colors {activeSection === 'addCol' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:bg-background/50'}"
                    onclick={() => activeSection = 'addCol'}
                >
                    Add Column
                </button>
            </div>

            <div class="p-4">
                {#if activeSection === 'addCol'}
                    <form onsubmit={handleAddColumn} class="flex flex-col gap-4">
                        <div class="grid grid-cols-4 gap-4">
                            <div class="flex flex-col gap-1.5">
                                <label class="text-xs font-medium">Column Name</label>
                                <input type="text" bind:value={newColumnName} class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" required />
                            </div>
                            <div class="flex flex-col gap-1.5">
                                <label class="text-xs font-medium">Data Type</label>
                                <select bind:value={newColumnType} class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" required>
                                    <option value="">Select Type</option>
                                    <option>INT</option><option>BIGINT</option><option>VARCHAR(255)</option>
                                    <option>TEXT</option><option>DATE</option><option>DATETIME</option>
                                    <option>BOOLEAN</option><option>JSON</option>
                                </select>
                            </div>
                            <div class="flex flex-col gap-1.5">
                                <label class="text-xs font-medium">Default Value</label>
                                <input type="text" bind:value={newColumnDefault} class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" placeholder="NULL" />
                            </div>
                            <div class="flex flex-col gap-1.5">
                                <label class="text-xs font-medium">Position</label>
                                <select bind:value={newColumnPosition} class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                                    <option value="LAST">Last</option>
                                    <option value="FIRST">First</option>
                                </select>
                            </div>
                        </div>
                        <div class="flex items-center gap-2">
                            <label class="flex items-center gap-2 text-sm">
                                <input type="checkbox" bind:checked={newColumnNull} class="rounded border-input text-primary" />
                                Allow NULL
                            </label>
                            <button type="submit" class="ml-auto inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4 py-2">
                                <Plus class="w-4 h-4 mr-2" />
                                Add Column
                            </button>
                        </div>
                    </form>
                {/if}
            </div>
        </div>
    </div>
</div>
