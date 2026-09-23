<script lang="ts">
    import { appState } from "$lib/state.svelte";
    import { socket } from "$lib/services/socket";
    import { ArrowUp, ArrowDown, Edit2, Copy, Trash2 } from "@lucide/svelte";
    import ContextMenu from "./ContextMenu.svelte";
    import Modal from "./Modal.svelte";
    import ExportModal from "./ExportModal.svelte";
    import ImportModal from "./ImportModal.svelte";
    import EditRowModal from "./EditRowModal.svelte";
    import SortModal from "./SortModal.svelte";
    import FilterModal from "./FilterModal.svelte";

    // --- Modal Visibility State ---
    let showExportModal = $state(false);
    let showImportModal = $state(false);
    let showSortModal = $state(false);
    let showFilterModal = $state(false);

    let tempSortColumn = $state<string | null>(null);
    let tempSortDirection = $state<"ASC" | "DESC">("ASC");

    // --- Temporary Filter State for FilterModal ---
    let tempFilters = $state<any[]>([]);
    let tempSearchLogic = $state<"AND" | "OR">("AND");

    // Opens Sort Modal and initializes it with current sort state
    function openSortModal() {
        tempSortColumn =
            appState.currentSortColumn ||
            (columns.length > 0 ? columns[0] : null);
        tempSortDirection = appState.currentSortDirection;
        showSortModal = true;
    }

    // Applies sort from modal to global appState and reloads data
    function applySort() {
        appState.currentSortColumn = tempSortColumn;
        appState.currentSortDirection = tempSortDirection;
        appState.currentPage = 1;
        showSortModal = false;
        loadData();
    }

    // Clears active sort from global appState
    function clearSort() {
        appState.currentSortColumn = null;
        appState.currentPage = 1;
        showSortModal = false;
        loadData();
    }

    // Opens Filter Modal and initializes with current filters
    function openFilterModal() {
        tempFilters = JSON.parse(JSON.stringify(appState.currentSearchFilters));
        tempSearchLogic = appState.currentSearchLogic;
        if (tempFilters.length === 0) {
            tempFilters = [
                { column: columns[0] || "", operator: "=", value: "" },
            ];
        }
        showFilterModal = true;
    }

    // Applies filters from modal to global appState and reloads data
    function applyFilter() {
        appState.currentSearchFilters = tempFilters.filter(
            (f) => f.column && f.operator && f.value !== "",
        );
        appState.currentSearchLogic = tempSearchLogic;
        appState.currentPage = 1;
        showFilterModal = false;
        loadData();
    }

    // Clears all filters
    function clearFilter() {
        appState.currentSearchFilters = [];
        appState.currentPage = 1;
        showFilterModal = false;
        loadData();
    }

    // Handles Export Operations via websockets
    function handleExport(
        level: "server" | "database" | "table",
        db: string | null,
        tbl: string | null,
        options: any,
    ) {
        if (level === "server") {
            socket.emit("export_server", { options });
        } else if (level === "table" && db && tbl) {
            socket.emit("export_table", { database: db, table: tbl, options });
        } else if (level === "database" && db) {
            socket.emit("export_database", { database: db, options });
        }
    }

    // --- Table Data State ---
    // data: Array of rows fetched from the server
    // columns: Keys extracted from the first row of data
    let data = $state<any[]>([]);
    let columns = $state<string[]>([]);
    let selectedRows = $state<number[]>([]);

    // --- Context Menu State ---
    let contextMenu = $state<{
        show: boolean;
        x: number;
        y: number;
        options: any[];
    }>({ show: false, x: 0, y: 0, options: [] });

    // --- Edit Row State ---
    let showEditModal = $state(false);
    let editRowData = $state<any>(null);
    let editPkColumn = $state("");
    let editPkValue = $state<any>(null);

    // --- WebSocket Event Listeners ---
    $effect(() => {
        // Listens for 'table_data' event and updates table state locally
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

    // Helper to toggle sort column directly from table header
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

    // --- Reactivity for Data Loading ---
    $effect(() => {
        // Auto-fetch data when relevant state changes (pagination, sort, filter)
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

    // Manually trigger data load
    function loadData() {
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

    // Parses enum options from schema to render select dropdowns in EditModal
    function getEnumOptions(col: string): string[] | null {
        // console.log("Current table structure", appState.currentTableStructure);
        if (!appState.currentTableStructure) return null;
        const columnDef = appState.currentTableStructure.find(
            (c: any) => c.Field === col,
        );
        // console.log("Column def", columnDef, "was finding for", col);
        if (!columnDef) return null;

        if (
            columnDef.Type &&
            columnDef.Type.toLowerCase().startsWith("enum(")
        ) {
            const match = columnDef.Type.match(/enum\((.*)\)/i);
            // console.log("Match", match);
            if (match && match[1]) {
                return match[1]
                    .split(",")
                    .map((s: string) => s.trim().replace(/^['"]|['"]$/g, ""));
            }
        }
        return null;
    }

    // Fetches primary key column from current table's schema
    function getPkColumn(): string {
        if (appState.currentTableStructure) {
            const pk = appState.currentTableStructure.find(
                (c: any) => c.Key === "PRI",
            );
            if (pk) return pk.Field;
        }
        return columns[0];
    }

    // Displays context menu on right click
    function handleRowContextMenu(e: MouseEvent, row: any, index: number) {
        e.preventDefault();
        const pkColumn = getPkColumn();
        const pkValue = row[pkColumn];

        contextMenu = {
            show: true,
            x: e.clientX,
            y: e.clientY,
            options: [
                {
                    label: "Edit Row",
                    icon: Edit2,
                    action: () => editRow(row, pkColumn, pkValue),
                },
                {
                    label: "Duplicate Row",
                    icon: Copy,
                    action: () => duplicateRow(row),
                },
                {
                    label: "Delete Row",
                    icon: Trash2,
                    class: "text-destructive",
                    action: () => deleteRow(pkColumn, pkValue),
                },
            ],
        };
    }

    // --- CRUD Operations ---

    function editRow(row: any, pkCol: string, pkVal: any) {
        // Create a deep copy to ensure Svelte 5 state reactivity doesn't interfere prematurely
        editRowData = JSON.parse(JSON.stringify(row));
        editPkColumn = pkCol;
        editPkValue = pkVal;
        showEditModal = true;
    }

    // Emits update event for modified row via socket
    function saveEditedRow() {
        if (
            !appState.currentDatabase ||
            !appState.currentTable ||
            !editPkColumn
        ) {
            console.log(
                "Returning because some values are null",
                appState.currentDatabase,
                appState.currentTable,
                editPkColumn,
            );
            return;
        }

        // Strip Svelte state proxy wrapper by copying data
        const updateData = JSON.parse(JSON.stringify(editRowData));
        console.log("Sending update row data", {
            database: appState.currentDatabase,
            table: appState.currentTable,
            primaryKeyColumn: editPkColumn,
            primaryKeyValue: editPkValue,
            updateData: updateData,
        });
        socket.emit("update_row", {
            database: appState.currentDatabase,
            table: appState.currentTable,
            primaryKeyColumn: editPkColumn,
            primaryKeyValue: editPkValue,
            updateData: updateData,
        });
        showEditModal = false;
        setTimeout(loadData, 500);
    }

    function duplicateRow(row: any) {
        // Strip auto-increment keys if possible, then insert
        const newRow = JSON.parse(JSON.stringify(row));
        const pkCol = getPkColumn();
        if (pkCol) delete newRow[pkCol];

        if (appState.currentDatabase && appState.currentTable) {
            socket.emit("insert_row", {
                database: appState.currentDatabase,
                table: appState.currentTable,
                rowData: newRow,
            });
        }
    }

    function deleteRow(pkCol: string, pkVal: any) {
        if (confirm("Delete this row?")) {
            if (appState.currentDatabase && appState.currentTable) {
                socket.emit("delete_selected_data", {
                    database: appState.currentDatabase,
                    table: appState.currentTable,
                    targetColumn: pkCol,
                    targetValues: [pkVal],
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
                const pkValues = selectedRows.map((i) => data[i][pkCol]);
                socket.emit("delete_selected_data", {
                    database: appState.currentDatabase,
                    table: appState.currentTable,
                    targetColumn: pkCol,
                    targetValues: pkValues,
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
            <button
                class="btn btn-sm btn-secondary text-xs {appState
                    .currentSearchFilters.length > 0
                    ? 'bg-primary/20 border-primary/30 text-primary'
                    : ''}"
                onclick={openFilterModal}>Filter</button
            >
            <button
                class="btn btn-sm btn-secondary text-xs {appState.currentSortColumn
                    ? 'bg-primary/20 border-primary/30 text-primary'
                    : ''}"
                onclick={openSortModal}>Sort</button
            >
            <button
                class="btn btn-sm btn-secondary text-xs"
                onclick={() => (showImportModal = true)}>Import</button
            >
            <button
                class="btn btn-sm btn-secondary text-xs"
                onclick={() => (showExportModal = true)}>Export</button
            >
            {#if selectedRows.length > 0}
                <div class="w-px h-4 bg-border mx-1"></div>
                <span
                    class="text-xs font-medium bg-primary/10 text-primary px-2 py-1 rounded"
                    >{selectedRows.length} selected</span
                >
                <button
                    class="btn btn-sm btn-secondary text-xs text-destructive hover:bg-destructive/10"
                    onclick={deleteSelectedRows}
                >
                    <Trash2 size={14} class="mr-1 inline" /> Delete Selected
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
                            oncontextmenu={(e) =>
                                handleRowContextMenu(e, row, i)}
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
                                    onclick={() =>
                                        editRow(
                                            row,
                                            getPkColumn(),
                                            row[getPkColumn()],
                                        )}>Edit</button
                                >
                                <button
                                    class="text-xs text-destructive hover:underline"
                                    onclick={() =>
                                        deleteRow(
                                            getPkColumn(),
                                            row[getPkColumn()],
                                        )}>Del</button
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

<EditRowModal
    bind:isOpen={showEditModal}
    {columns}
    bind:editRowData
    {editPkColumn}
    {getEnumOptions}
    onSave={saveEditedRow}
/>

<SortModal
    bind:isOpen={showSortModal}
    {columns}
    bind:tempSortColumn
    bind:tempSortDirection
    onApply={applySort}
    onClear={clearSort}
/>

<FilterModal
    bind:isOpen={showFilterModal}
    {columns}
    bind:tempFilters
    bind:tempSearchLogic
    onApply={applyFilter}
    onClear={clearFilter}
/>

<ExportModal
    show={showExportModal}
    initialDatabase={appState.currentDatabase}
    initialTable={appState.currentTable}
    selectedPKValues={selectedRows.length > 0
        ? selectedRows.map((i) => data[i][columns[0]])
        : null}
    pkColumn={selectedRows.length > 0 ? columns[0] : null}
    onClose={() => (showExportModal = false)}
    onExport={handleExport}
/>

{#if showImportModal}
    <ImportModal
        show={showImportModal}
        onClose={() => (showImportModal = false)}
    />
{/if}
