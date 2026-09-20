<script lang="ts">
    import { X, Download } from "@lucide/svelte";
    import { scale, fade } from "svelte/transition";
    import type { ExportOptions } from "$lib/types";

    export let show: boolean;
    export let initialDatabase: string | null = null;
    export let initialTable: string | null = null;
    export let selectedPKValues: unknown[] | null = null;
    export let pkColumn: string | null = null;
    export let onClose: () => void;
    export let onExport: (level: 'server'|'database'|'table', db: string | null, tbl: string | null, options: ExportOptions) => void;

    import { appState } from "$lib/state.svelte";

    let targetLevel: 'server' | 'database' | 'table' | 'table_selected' = 'server';
    let selectedDb: string | null = null;
    let selectedTable: string | null = null;

    $: if (show) {
        selectedDb = initialDatabase || appState.currentDatabase;
        selectedTable = initialTable || appState.currentTable;
        if (selectedTable && selectedDb) {
            if (selectedPKValues && selectedPKValues.length > 0) {
                targetLevel = 'table_selected';
            } else {
                targetLevel = 'table';
            }
        } else if (selectedDb) {
            targetLevel = 'database';
        } else {
            targetLevel = 'server';
        }
    }

    let format: 'sql' | 'json' = 'sql';
    let includeData: boolean = true;
    let outputStructure: 'single' | 'split' = 'single';

    // Disable split if not including data
    $: if (!includeData) {
        outputStructure = 'single';
    }

    function handleExport() {
        const options: ExportOptions = {
            format,
            includeData,
            separateData: outputStructure === 'split',
            exportMethod: 'single'
        };

        if (targetLevel === 'table' || targetLevel === 'table_selected') {
            options.selectedTables = selectedTable ? [selectedTable] : null;
            options.exportMethod = 'single';
            options.separateData = outputStructure === 'split';
            if (targetLevel === 'table_selected') {
                options.selectedPKValues = selectedPKValues;
                options.pkColumn = pkColumn;
            }
        } else {
            if (outputStructure === 'split') {
                options.exportMethod = 'split'; 
                options.separateData = false;
            } else {
                options.exportMethod = 'single';
                options.separateData = false;
            }
        }

        onExport(targetLevel === 'table_selected' ? 'table' : targetLevel, selectedDb, selectedTable, options);
        onClose();
    }
</script>

{#if show}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm" transition:fade={{duration: 150}}>
        <div class="bg-card w-full max-w-md rounded-xl shadow-lg border flex flex-col" transition:scale={{duration: 150, start: 0.95}}>
            <div class="flex items-center justify-between p-4 border-b">
                <h2 class="text-lg font-semibold flex items-center gap-2">
                    <Download size={20} class="text-primary"/>
                    Export Data
                </h2>
                <button class="p-1 hover:bg-muted rounded-md transition-colors" onclick={onClose}>
                    <X size={20} />
                </button>
            </div>
            
            <div class="p-4 flex flex-col gap-4">
                <div class="space-y-1">
                    <label for="export-target" class="text-sm font-medium">Export Target</label>
                    <div class="flex gap-2">
                        <select id="export-target" class="flex-1 bg-background border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" bind:value={targetLevel}>
                            <option value="server">Entire Server</option>
                            <option value="database" disabled={!selectedDb}>Database: {selectedDb || 'None selected'}</option>
                            <option value="table" disabled={!selectedTable}>Table: {selectedTable || 'None selected'}</option>
                            {#if selectedPKValues && selectedPKValues.length > 0}
                                <option value="table_selected">Table: {selectedTable} ({selectedPKValues.length} Selected Rows)</option>
                            {/if}
                        </select>
                    </div>
                    <p class="text-[11px] text-muted-foreground mt-1">
                        {#if targetLevel === 'server'}
                            Will export all databases.
                        {:else if targetLevel === 'database'}
                            Will export all tables in database `{selectedDb}`.
                        {:else if targetLevel === 'table' || targetLevel === 'table_selected'}
                            Will export the `{selectedTable}` table in `{selectedDb}` {#if targetLevel === 'table_selected'}({selectedPKValues?.length} rows){/if}.
                        {/if}
                    </p>
                </div>
                <div class="space-y-1">
                    <label for="export-format" class="text-sm font-medium">Export Format</label>
                    <select id="export-format" class="w-full bg-background border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" bind:value={format}>
                        <option value="sql">SQL</option>
                        <option value="json">JSON</option>
                    </select>
                </div>

                <div class="space-y-1">
                    <label for="export-include" class="text-sm font-medium">Include</label>
                    <select id="export-include" class="w-full bg-background border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" bind:value={includeData}>
                        <option value={true}>Structure + Data</option>
                        <option value={false}>Structure Only</option>
                    </select>
                </div>

                <div class="space-y-1">
                    <label for="export-structure" class="text-sm font-medium">Output File Structure</label>
                    <select id="export-structure" class="w-full bg-background border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" bind:value={outputStructure} disabled={!includeData}>
                        <option value="single">Single File</option>
                        <option value="split">Separate Structure & Data in ZIP</option>
                    </select>
                </div>
            </div>

            <div class="p-4 border-t bg-muted/50 flex justify-end gap-2 rounded-b-xl">
                <button class="px-4 py-2 text-sm font-medium hover:bg-muted rounded-md transition-colors" onclick={onClose}>
                    Cancel
                </button>
                <button class="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity flex items-center gap-2" onclick={handleExport}>
                    <Download size={16} /> Export
                </button>
            </div>
        </div>
    </div>
{/if}
