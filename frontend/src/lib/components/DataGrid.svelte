<script lang="ts">
    import { appState } from "$lib/state.svelte";
    import { socket } from "$lib/services/socket";
    import { ArrowUp, ArrowDown, Edit2, Copy, Trash2 } from "@lucide/svelte";
    import ContextMenu from "./ContextMenu.svelte";
    import Modal from "./Modal.svelte";
    import ExportModal from "./ExportModal.svelte";
    import ImportModal from "./ImportModal.svelte";

    let showExportModal = $state(false);
    let showImportModal = $state(false);
    let showSortModal = $state(false);
    let showFilterModal = $state(false);

    let tempSortColumn = $state<string | null>(null);
    let tempSortDirection = $state<'ASC'|'DESC'>('ASC');
    
    let tempFilters = $state<any[]>([]);
    let tempSearchLogic = $state<'AND'|'OR'>('AND');

    function openSortModal() {
        tempSortColumn = appState.currentSortColumn || (columns.length > 0 ? columns[0] : null);
        tempSortDirection = appState.currentSortDirection;
        showSortModal = true;
    }

    function applySort() {
        appState.currentSortColumn = tempSortColumn;
        appState.currentSortDirection = tempSortDirection;
        appState.currentPage = 1;
        showSortModal = false;
        loadData();
    }
    
    function clearSort() {
        appState.currentSortColumn = null;
        appState.currentPage = 1;
        showSortModal = false;
        loadData();
    }

    function openFilterModal() {
        tempFilters = JSON.parse(JSON.stringify(appState.currentSearchFilters));
        tempSearchLogic = appState.currentSearchLogic;
        if (tempFilters.length === 0) {
            addFilter();
        }
        showFilterModal = true;
    }

    function addFilter() {
        tempFilters = [...tempFilters, { column: columns[0] || '', operator: '=', value: '' }];
    }

    function removeFilter(index: number) {
        tempFilters = tempFilters.filter((_, i) => i !== index);
    }

    function applyFilter() {
        appState.currentSearchFilters = tempFilters.filter(f => f.column && f.operator && f.value !== '');
        appState.currentSearchLogic = tempSearchLogic;
        appState.currentPage = 1;
        showFilterModal = false;
        loadData();
    }

    function clearFilter() {
        appState.currentSearchFilters = [];
        appState.currentPage = 1;
        showFilterModal = false;
        loadData();
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

    // We expect the backend to send the table data over socket
    // Alternatively, we could have state.ts store it, but let's keep it here for now
    let data = $state<any[]>([]);
    let columns = $state<string[]>([]);
    let selectedRows = $state<number[]>([]);
    
    let contextMenu = $state<{
        show: boolean;
        x: number;
        y: number;
        options: any[];
    }>({ show: false, x: 0, y: 0, options: [] });

    let showEditModal = $state(false);
    let editRowData = $state<any>(null);
    let editPkColumn = $state("");
    let editPkValue = $state<any>(null);

    $effect(() => {
        const handleData = (payload: {
            data: any[];
            total: number;
            limit: number;
            offset: number;
        }) => {
            data = payload.data;
            appState.totalRows = payload.total;
            if (data.length > 0) {
                columns = Object.keys(data[0]);
            } else {
                columns = [];
            }
            selectedRows = [];
        };

        socket.on("table_data", handleData);

        return () => {
            socket.off("table_data", handleData);
        };
    });

    function toggleSort(col: string) {
        if (appState.currentSortColumn === col) {
            appState.currentSortDirection =
                appState.currentSortDirection === "ASC" ? "DESC" : "ASC";
        } else {
            appState.currentSortColumn = col;
            appState.currentSortDirection = "ASC";
        }
        loadData();
    }

    $effect(() => {
        // Auto-fetch data when relevant state changes
        if (appState.currentDatabase && appState.currentTable) {
            const offset = (appState.currentPage - 1) * appState.pageSize;
            socket.emit("get_table_data", {
                database: appState.currentDatabase,
                table: appState.currentTable,
                limit: appState.pageSize,
                offset,
                sortColumn: appState.currentSortColumn,
                sortDirection: appState.currentSortDirection,
                searchFilters: appState.currentSearchFilters.length
                    ? appState.currentSearchFilters
                    : null,
                searchLogic: appState.currentSearchLogic,
            });
        }
    });

    function loadData() {
        // This can be kept for manual refresh if needed, but the $effect handles automatic fetching
        if (!appState.currentDatabase || !appState.currentTable) return;
        const offset = (appState.currentPage - 1) * appState.pageSize;
        socket.emit("get_table_data", {
            database: appState.currentDatabase,
            table: appState.currentTable,
            limit: appState.pageSize,
            offset,
            sortColumn: appState.currentSortColumn,
            sortDirection: appState.currentSortDirection,
            searchFilters: appState.currentSearchFilters.length
                ? appState.currentSearchFilters
                : null,
            searchLogic: appState.currentSearchLogic,
        });
    }

    function toggleAllRows(e: Event) {
        const checked = (e.target as HTMLInputElement).checked;
        if (checked) {
            selectedRows = data.map((_: any, i: number) => i);
        } else {
            selectedRows = [];
        }
    }

    function toggleRow(i: number) {
        if (selectedRows.includes(i)) {
            selectedRows = selectedRows.filter((r: number) => r !== i);
        } else {
            selectedRows = [...selectedRows, i];
        }
    }

    function handleRowContextMenu(e: MouseEvent, row: any, index: number) {
        e.preventDefault();
        // Fallback to the first column as PK if none defined by user
        const pkColumn = columns[0]; 
        const pkValue = row[pkColumn];
        
        contextMenu = {
            show: true,
            x: e.clientX,
            y: e.clientY,
            options: [
                { label: "Edit Row", icon: Edit2, action: () => editRow(row, pkColumn, pkValue) },
                { label: "Duplicate Row", icon: Copy, action: () => duplicateRow(row) },
                { label: "Delete Row", icon: Trash2, class: "text-destructive", action: () => deleteRow(pkColumn, pkValue) }
            ]
        };
    }

    function editRow(row: any, pkCol: string, pkVal: any) {
        editRowData = { ...row };
        editPkColumn = pkCol;
        editPkValue = pkVal;
        showEditModal = true;
    }

    function saveEditedRow() {
        if (!appState.currentDatabase || !appState.currentTable || !editPkColumn) return;
        socket.emit("update_row", {
            database: appState.currentDatabase,
            table: appState.currentTable,
            primaryKeyColumn: editPkColumn,
            primaryKeyValue: editPkValue,
            updateData: editRowData
        });
        showEditModal = false;
        setTimeout(loadData, 500);
    }

    function duplicateRow(row: any) {
        // Strip auto-increment keys if possible, then insert
        // For now, just send the whole row as insert (it might fail if PK is auto-increment but included)
        const newRow = { ...row };
        // Basic heuristic to remove 'id' if it's the first column
        if (columns[0].toLowerCase() === 'id') delete newRow[columns[0]];
        
        if (appState.currentDatabase && appState.currentTable) {
            socket.emit("insert_row", { database: appState.currentDatabase, table: appState.currentTable, rowData: newRow });
        }
    }

    function deleteRow(pkCol: string, pkVal: any) {
        if (confirm("Delete this row?")) {
            if (appState.currentDatabase && appState.currentTable) {
                socket.emit("delete_selected_data", { 
                    database: appState.currentDatabase, 
                    table: appState.currentTable, 
                    targetColumn: pkCol, 
                    targetValues: [pkVal] 
                });
                // We could reload data here or rely on socket broadcast
                setTimeout(loadData, 500); 
            }
        }
    }
    function deleteSelectedRows() {
        if (confirm(`Delete ${selectedRows.length} selected rows?`)) {
            if (appState.currentDatabase && appState.currentTable) {
                const pkCol = columns[0];
                const pkValues = selectedRows.map(i => data[i][pkCol]);
                socket.emit("delete_selected_data", {
                    database: appState.currentDatabase,
                    table: appState.currentTable,
                    targetColumn: pkCol,
                    targetValues: pkValues
                });
                setTimeout(loadData, 500);
            }
        }
    }
</script>

<div
    class="flex flex-col h-full bg-card rounded-md border shadow-sm overflow-hidden"
>
    <!-- Toolbar -->
    <div class="p-2 border-b flex items-center justify-between bg-muted/30">
        <div class="flex items-center gap-2">
            <button class="btn btn-sm btn-secondary text-xs {appState.currentSearchFilters.length > 0 ? 'bg-primary/20 border-primary/30 text-primary' : ''}" onclick={openFilterModal}>Filter</button>
            <button class="btn btn-sm btn-secondary text-xs {appState.currentSortColumn ? 'bg-primary/20 border-primary/30 text-primary' : ''}" onclick={openSortModal}>Sort</button>
            <button class="btn btn-sm btn-secondary text-xs" onclick={() => showImportModal = true}>Import</button>
            <button class="btn btn-sm btn-secondary text-xs" onclick={() => showExportModal = true}>Export</button>
            {#if selectedRows.length > 0}
                <div class="w-px h-4 bg-border mx-1"></div>
                <span class="text-xs font-medium bg-primary/10 text-primary px-2 py-1 rounded">{selectedRows.length} selected</span>
                <button class="btn btn-sm btn-secondary text-xs text-destructive hover:bg-destructive/10" onclick={deleteSelectedRows}>
                    <Trash2 size={14} class="mr-1 inline"/> Delete Selected
                </button>
            {/if}
        </div>
        <div class="text-xs text-muted-foreground flex items-center gap-2">
            <span>
                {#if appState.totalRows > 0}
                    {(appState.currentPage - 1) * appState.pageSize + 1} - {Math.min(
                        appState.currentPage * appState.pageSize,
                        appState.totalRows,
                    )} of {appState.totalRows}
                {:else}
                    0 rows
                {/if}
            </span>
            <div class="flex items-center">
                <button
                    class="px-2 py-1 border-r border-y rounded-l-md hover:bg-secondary disabled:opacity-50"
                    disabled={appState.currentPage === 1}
                    onclick={() => {
                        appState.currentPage--;
                        loadData();
                    }}>‹</button
                >
                <button
                    class="px-2 py-1 border rounded-r-md hover:bg-secondary disabled:opacity-50"
                    disabled={appState.currentPage * appState.pageSize >=
                        appState.totalRows}
                    onclick={() => {
                        appState.currentPage++;
                        loadData();
                    }}>›</button
                >
            </div>
        </div>
    </div>

    <!-- Table -->
    <div class="flex-1 overflow-auto">
        <table class="w-full text-sm text-left border-collapse">
            <thead
                class="text-xs text-muted-foreground uppercase bg-muted/50 sticky top-0 shadow-sm z-10"
            >
                <tr>
                    <th class="px-4 py-2 border-b w-10">
                        <input
                            type="checkbox"
                            onchange={toggleAllRows}
                            checked={data.length > 0 &&
                                selectedRows.length === data.length}
                        />
                    </th>
                    {#each columns as col}
                        <th
                            class="px-4 py-2 border-b cursor-pointer hover:bg-muted/80 whitespace-nowrap"
                            onclick={() => toggleSort(col)}
                        >
                            <div class="flex items-center gap-1">
                                {col}
                                {#if appState.currentSortColumn === col}
                                    {#if appState.currentSortDirection === "ASC"}
                                        <ArrowUp
                                            size={12}
                                            class="text-primary"
                                        />
                                    {:else}
                                        <ArrowDown
                                            size={12}
                                            class="text-primary"
                                        />
                                    {/if}
                                {/if}
                            </div>
                        </th>
                    {/each}
                    <th class="px-4 py-2 border-b">Actions</th>
                </tr>
            </thead>
            <tbody>
                {#if data.length === 0}
                    <tr>
                        <td
                            colspan="99"
                            class="px-4 py-10 text-center text-muted-foreground italic"
                        >
                            No data found in {appState.currentTable}
                        </td>
                    </tr>
                {:else}
                    {#each data as row, i}
                        <tr
                            class="border-b hover:bg-muted/30 {selectedRows.includes(
                                i,
                            )
                                ? 'bg-primary/5'
                                : ''}"
                            oncontextmenu={(e) => handleRowContextMenu(e, row, i)}
                        >
                            <td class="px-4 py-2">
                                <input
                                    type="checkbox"
                                    checked={selectedRows.includes(i)}
                                    onchange={() => toggleRow(i)}
                                />
                            </td>
                            {#each columns as col}
                                <td
                                    class="px-4 py-2 whitespace-nowrap max-w-[250px] overflow-hidden text-ellipsis"
                                    title={String(row[col])}
                                >
                                    {#if row[col] === null}
                                        <span
                                            class="text-muted-foreground italic text-xs"
                                            >NULL</span
                                        >
                                    {:else if typeof row[col] === "object"}
                                        {JSON.stringify(row[col])}
                                    {:else}
                                        {String(row[col])}
                                    {/if}
                                </td>
                            {/each}
                            <td class="px-4 py-2 whitespace-nowrap">
                                <button
                                    class="text-xs text-primary hover:underline mr-2"
                                    onclick={() => editRow(row, columns[0], row[columns[0]])}
                                    >Edit</button
                                >
                                <button
                                    class="text-xs text-destructive hover:underline"
                                    onclick={() => deleteRow(columns[0], row[columns[0]])}
                                    >Del</button
                                >
                            </td>
                        </tr>
                    {/each}
                {/if}
            </tbody>
        </table>
    </div>
</div>

{#if contextMenu.show}
    <ContextMenu
        x={contextMenu.x}
        y={contextMenu.y}
        options={contextMenu.options}
        onClose={() => (contextMenu.show = false)}
    />
{/if}

<Modal bind:isOpen={showEditModal} title="Edit Row">
    <div class="flex flex-col gap-4">
        {#if editRowData}
            {#each columns as col}
                <div class="flex flex-col gap-1">
                    <label for="edit-{col}" class="text-sm font-medium">{col}</label>
                    <input 
                        id="edit-{col}"
                        type="text" 
                        class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                        bind:value={editRowData[col]}
                        disabled={col === editPkColumn}
                    />
                </div>
            {/each}
            <div class="flex justify-end gap-2 mt-4">
                <button class="px-4 py-2 text-sm font-medium rounded-md hover:bg-secondary transition-colors" onclick={() => showEditModal = false}>Cancel</button>
                <button class="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors" onclick={saveEditedRow}>Save Changes</button>
            </div>
        {/if}
    </div>
</Modal>

<Modal bind:isOpen={showSortModal} title="Sort Data">
    <div class="flex flex-col gap-4">
        <div class="flex items-center gap-2">
            <select class="flex-1 bg-background border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" bind:value={tempSortColumn}>
                {#each columns as col}
                    <option value={col}>{col}</option>
                {/each}
            </select>
            <select class="w-32 bg-background border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" bind:value={tempSortDirection}>
                <option value="ASC">Ascending</option>
                <option value="DESC">Descending</option>
            </select>
        </div>
        <div class="flex justify-end gap-2 mt-4 pt-4 border-t">
            <button class="px-4 py-2 text-sm font-medium hover:bg-muted rounded-md transition-colors text-destructive" onclick={clearSort}>Clear Sort</button>
            <button class="px-4 py-2 text-sm font-medium hover:bg-muted rounded-md transition-colors" onclick={() => showSortModal = false}>Cancel</button>
            <button class="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity" onclick={applySort}>Apply</button>
        </div>
    </div>
</Modal>

<Modal bind:isOpen={showFilterModal} title="Filter Data">
    <div class="flex flex-col gap-4">
        {#each tempFilters as filter, index}
            <div class="flex items-center gap-2">
                <select class="flex-1 bg-background border rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" bind:value={filter.column}>
                    {#each columns as col}
                        <option value={col}>{col}</option>
                    {/each}
                </select>
                <select class="w-32 bg-background border rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" bind:value={filter.operator}>
                    <option value="=">=</option>
                    <option value="!=">!=</option>
                    <option value=">">&gt;</option>
                    <option value="<">&lt;</option>
                    <option value=">=">&gt;=</option>
                    <option value="<=">&lt;=</option>
                    <option value="LIKE">LIKE</option>
                    <option value="NOT LIKE">NOT LIKE</option>
                </select>
                <input 
                    type="text" 
                    class="flex-1 h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    placeholder="Value..."
                    bind:value={filter.value}
                />
                <button class="p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive rounded-md transition-colors" onclick={() => removeFilter(index)}>
                    <Trash2 size={16}/>
                </button>
            </div>
            {#if index < tempFilters.length - 1}
                <div class="flex justify-center -my-2 relative z-10">
                    <select class="bg-muted text-xs font-medium px-2 py-1 rounded-full border border-border focus:outline-none" bind:value={tempSearchLogic}>
                        <option value="AND">AND</option>
                        <option value="OR">OR</option>
                    </select>
                </div>
            {/if}
        {/each}
        
        <div class="mt-2">
            <button class="text-sm font-medium text-primary hover:underline" onclick={addFilter}>+ Add Filter</button>
        </div>

        <div class="flex justify-end gap-2 mt-4 pt-4 border-t">
            <button class="px-4 py-2 text-sm font-medium hover:bg-muted rounded-md transition-colors text-destructive" onclick={clearFilter}>Clear Filters</button>
            <button class="px-4 py-2 text-sm font-medium hover:bg-muted rounded-md transition-colors" onclick={() => showFilterModal = false}>Cancel</button>
            <button class="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity" onclick={applyFilter}>Apply Filters</button>
        </div>
    </div>
</Modal>

<ExportModal 
    show={showExportModal} 
    initialDatabase={appState.currentDatabase}
    initialTable={appState.currentTable}
    selectedPKValues={selectedRows.length > 0 ? selectedRows.map(i => data[i][columns[0]]) : null}
    pkColumn={selectedRows.length > 0 ? columns[0] : null}
    onClose={() => showExportModal = false}
    onExport={handleExport}
/>

{#if showImportModal}
<ImportModal
    show={showImportModal}
    onClose={() => showImportModal = false}
/>
{/if}
