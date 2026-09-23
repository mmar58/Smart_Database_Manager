<script lang="ts">
    import { Trash2 } from "@lucide/svelte";
    import Modal from "./Modal.svelte";

    let {
        isOpen = $bindable(false),
        columns = [],
        tempFilters = $bindable([]),
        tempSearchLogic = $bindable("AND"),
        onApply,
        onClear
    } : {
        isOpen: boolean;
        columns: string[];
        tempFilters: any[];
        tempSearchLogic: 'AND' | 'OR';
        onApply: () => void;
        onClear: () => void;
    } = $props();

    function addFilter() {
        tempFilters = [...tempFilters, { column: columns[0] || '', operator: '=', value: '' }];
    }

    function removeFilter(index: number) {
        tempFilters = tempFilters.filter((_, i) => i !== index);
    }

    function cancel() {
        isOpen = false;
    }
</script>

<Modal bind:isOpen={isOpen} title="Filter Data">
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
            <button class="px-4 py-2 text-sm font-medium hover:bg-muted rounded-md transition-colors text-destructive" onclick={onClear}>Clear Filters</button>
            <button class="px-4 py-2 text-sm font-medium hover:bg-muted rounded-md transition-colors" onclick={cancel}>Cancel</button>
            <button class="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity" onclick={onApply}>Apply Filters</button>
        </div>
    </div>
</Modal>
