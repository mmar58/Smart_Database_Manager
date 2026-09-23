<script lang="ts">
    import Modal from "./Modal.svelte";

    let {
        isOpen = $bindable(false),
        columns = [],
        editRowData = $bindable(null),
        editPkColumn = "",
        getEnumOptions,
        onSave,
    }: {
        isOpen: boolean;
        columns: string[];
        editRowData: any;
        editPkColumn: string;
        getEnumOptions: (col: string) => string[] | null;
        onSave: () => void;
    } = $props();

    function cancel() {
        isOpen = false;
    }
</script>

<Modal bind:isOpen title="Edit Row">
    {console.log(editRowData)}
    <div class="flex flex-col gap-4">
        {#if editRowData}
            {#each columns as col}
                <div class="flex flex-col gap-1">
                    <label for="edit-{col}" class="text-sm font-medium"
                        >{col}</label
                    >
                    {#if getEnumOptions(col)}
                        <select
                            id="edit-{col}"
                            class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                            bind:value={editRowData[col]}
                            disabled={col === editPkColumn}
                        >
                            {#each getEnumOptions(col) as option}
                                <option value={option}>{option}</option>
                            {/each}
                        </select>
                    {:else}
                        <input
                            id="edit-{col}"
                            type="text"
                            class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                            bind:value={editRowData[col]}
                            disabled={col === editPkColumn}
                        />
                    {/if}
                </div>
            {/each}
            <div class="flex justify-end gap-2 mt-4">
                <button
                    class="px-4 py-2 text-sm font-medium rounded-md hover:bg-secondary transition-colors"
                    onclick={cancel}>Cancel</button
                >
                <button
                    class="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                    onclick={onSave}>Save Changes</button
                >
            </div>
        {/if}
    </div>
</Modal>
