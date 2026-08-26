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

    // Drop Col
    let dropColumnName = $state("");

    // Modify Col
    let modifyColumnName = $state("");
    let modifyColumnType = $state("");
    let modifyColumnDefault = $state("");
    let modifyColumnNull = $state(false);

    onMount(() => {
        // Initial load if structure was requested
        if (appState.currentDatabase && appState.currentTable) {
            socket.emit("get_table_structure", { 
                database: appState.currentDatabase, 
                table: appState.currentTable 
            });
        }

        socket.on("table_structure", (data: TableColumn[]) => {
            structure = data;
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
        socket.emit("execute_query", appState.currentDatabase, query);
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

    function handleDropColumn(e: Event) {
        e.preventDefault();
        if (!dropColumnName || !appState.currentTable) return;
        if (!confirm(`Drop column ${dropColumnName}?`)) return;
        
        const query = `ALTER TABLE \`${appState.currentTable}\` DROP COLUMN \`${dropColumnName}\``;
        executeAlter(query);
    }

    function handleModifyColumn(e: Event) {
        e.preventDefault();
        if (!modifyColumnName || !modifyColumnType || !appState.currentTable) return;
        
        let query = `ALTER TABLE \`${appState.currentTable}\` MODIFY COLUMN \`${modifyColumnName}\` ${modifyColumnType}`;
        if (!modifyColumnNull) query += " NOT NULL";
        if (modifyColumnDefault) query += ` DEFAULT '${modifyColumnDefault}'`;
        
        executeAlter(query);
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
                        </tr>
                    </thead>
                    <tbody>
                        {#each structure as col}
                            <tr class="border-b hover:bg-muted/50">
                                <td class="px-4 py-3 font-medium">{col.Field}</td>
                                <td class="px-4 py-3 font-mono text-muted-foreground">{col.Type}</td>
                                <td class="px-4 py-3">{col.Null}</td>
                                <td class="px-4 py-3 font-medium text-primary">{col.Key}</td>
                                <td class="px-4 py-3 text-muted-foreground">{col.Default === null ? 'NULL' : col.Default}</td>
                                <td class="px-4 py-3 text-muted-foreground">{col.Extra}</td>
                            </tr>
                        {/each}
                        {#if structure.length === 0}
                            <tr>
                                <td colspan="6" class="px-4 py-8 text-center text-muted-foreground">
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
                <button 
                    class="px-3 py-1.5 text-sm font-medium rounded-md transition-colors {activeSection === 'modifyCol' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:bg-background/50'}"
                    onclick={() => activeSection = 'modifyCol'}
                >
                    Modify Column
                </button>
                <button 
                    class="px-3 py-1.5 text-sm font-medium rounded-md transition-colors {activeSection === 'dropCol' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:bg-background/50'}"
                    onclick={() => activeSection = 'dropCol'}
                >
                    Drop Column
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

                {#if activeSection === 'modifyCol'}
                    <form onsubmit={handleModifyColumn} class="flex flex-col gap-4">
                        <div class="grid grid-cols-3 gap-4">
                            <div class="flex flex-col gap-1.5">
                                <label class="text-xs font-medium">Column to Modify</label>
                                <select bind:value={modifyColumnName} class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" required>
                                    <option value="">Select Column</option>
                                    {#each structure as col}
                                        <option value={col.Field}>{col.Field}</option>
                                    {/each}
                                </select>
                            </div>
                            <div class="flex flex-col gap-1.5">
                                <label class="text-xs font-medium">New Data Type</label>
                                <select bind:value={modifyColumnType} class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" required>
                                    <option value="">Select Type</option>
                                    <option>INT</option><option>BIGINT</option><option>VARCHAR(255)</option>
                                    <option>TEXT</option><option>DATE</option><option>DATETIME</option>
                                    <option>BOOLEAN</option><option>JSON</option>
                                </select>
                            </div>
                            <div class="flex flex-col gap-1.5">
                                <label class="text-xs font-medium">Default Value</label>
                                <input type="text" bind:value={modifyColumnDefault} class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" placeholder="NULL" />
                            </div>
                        </div>
                        <div class="flex items-center gap-2">
                            <label class="flex items-center gap-2 text-sm">
                                <input type="checkbox" bind:checked={modifyColumnNull} class="rounded border-input text-primary" />
                                Allow NULL
                            </label>
                            <button type="submit" class="ml-auto inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4 py-2">
                                <Edit2 class="w-4 h-4 mr-2" />
                                Modify Column
                            </button>
                        </div>
                    </form>
                {/if}

                {#if activeSection === 'dropCol'}
                    <form onsubmit={handleDropColumn} class="flex flex-col gap-4">
                        <div class="flex gap-4 items-end">
                            <div class="flex flex-col gap-1.5 flex-1">
                                <label class="text-xs font-medium">Column to Drop</label>
                                <select bind:value={dropColumnName} class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" required>
                                    <option value="">Select Column</option>
                                    {#each structure as col}
                                        <option value={col.Field}>{col.Field}</option>
                                    {/each}
                                </select>
                            </div>
                            <button type="submit" class="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 h-9 px-4 py-2">
                                <Trash2 class="w-4 h-4 mr-2" />
                                Drop Column
                            </button>
                        </div>
                    </form>
                {/if}
            </div>
        </div>
    </div>
</div>
