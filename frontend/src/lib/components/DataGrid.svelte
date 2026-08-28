<script lang="ts">
    import { appState } from "$lib/state.svelte";
    import { socket } from "$lib/services/socket";
    import { ArrowUp, ArrowDown } from "@lucide/svelte";

    // We expect the backend to send the table data over socket
    // Alternatively, we could have state.ts store it, but let's keep it here for now
    let data = $state<any[]>([]);
    let columns = $state<string[]>([]);
    let selectedRows = $state<number[]>([]);

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
</script>

<div
    class="flex flex-col h-full bg-card rounded-md border shadow-sm overflow-hidden"
>
    <!-- Toolbar -->
    <div class="p-2 border-b flex items-center justify-between bg-muted/30">
        <div class="flex items-center gap-2">
            <button class="btn btn-sm btn-secondary text-xs">Filter</button>
            <button class="btn btn-sm btn-secondary text-xs">Sort</button>
            <button class="btn btn-sm btn-secondary text-xs">Export</button>
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
                                    >Edit</button
                                >
                                <button
                                    class="text-xs text-destructive hover:underline"
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
