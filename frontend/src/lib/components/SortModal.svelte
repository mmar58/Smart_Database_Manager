<script lang="ts">
    import Modal from "./Modal.svelte";

    let {
        isOpen = $bindable(false),
        columns = [],
        tempSortColumn = $bindable(null),
        tempSortDirection = $bindable("ASC"),
        onApply,
        onClear
    } : {
        isOpen: boolean;
        columns: string[];
        tempSortColumn: string | null;
        tempSortDirection: 'ASC' | 'DESC';
        onApply: () => void;
        onClear: () => void;
    } = $props();

    function cancel() {
        isOpen = false;
    }
</script>

<Modal bind:isOpen={isOpen} title="Sort Data">
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
            <button class="px-4 py-2 text-sm font-medium hover:bg-muted rounded-md transition-colors text-destructive" onclick={onClear}>Clear Sort</button>
            <button class="px-4 py-2 text-sm font-medium hover:bg-muted rounded-md transition-colors" onclick={cancel}>Cancel</button>
            <button class="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity" onclick={onApply}>Apply</button>
        </div>
    </div>
</Modal>
