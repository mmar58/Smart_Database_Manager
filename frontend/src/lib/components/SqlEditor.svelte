<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { socket } from "$lib/services/socket";
    import { appState } from "$lib/state.svelte";
    import { Play, Code, Clock, Trash2 } from "@lucide/svelte";
    // We use basic textarea for now to avoid CM6 Svelte SSR issues,
    // will upgrade to CodeMirror if needed.

    let query = $state("");
    let results = $state<any[] | null>(null);
    let columns = $state<string[]>([]);
    let error = $state("");
    let executionTime = $state("");
    let isExecuting = $state(false);
    let history = $state<{ query: string; time: string }[]>([]);

    onMount(() => {
        socket.on("query_result", (data: any) => {
            isExecuting = false;
            error = "";
            results = data.rows || [];
            if (results && results.length > 0) {
                columns = Object.keys(results[0]);
            } else {
                columns = [];
            }
            executionTime = `Executed in ${data.time || "0ms"}`;

            // Add to history
            history = [
                { query: data.query, time: new Date().toLocaleTimeString() },
                ...history,
            ].slice(0, 50);
        });

        socket.on("query_error", (msg: string) => {
            isExecuting = false;
            error = msg;
            results = null;
            columns = [];
            executionTime = "";
        });

        socket.on("query_info", (msg: string) => {
            isExecuting = false;
            error = "";
            results = null;
            columns = [];
            executionTime = msg;
        });

        return () => {
            socket.off("query_result");
            socket.off("query_error");
            socket.off("query_info");
        };
    });

    function executeQuery() {
        if (!query.trim()) return;
        if (!appState.currentDatabase) {
            error = "Please select a database first.";
            return;
        }

        isExecuting = true;
        error = "";
        socket.emit("execute_query", appState.currentDatabase, query);
    }
</script>

<div class="flex flex-col h-full bg-background relative">
    <div class="flex items-center gap-2 p-2 border-b bg-muted/30">
        <button
            class="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            onclick={executeQuery}
            disabled={isExecuting || !query.trim()}
        >
            {#if isExecuting}
                <div
                    class="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-r-transparent"
                ></div>
                Executing...
            {:else}
                <Play class="w-4 h-4" />
                Execute
            {/if}
        </button>
        <button
            class="flex items-center gap-2 px-3 py-1.5 bg-secondary text-secondary-foreground rounded-md text-sm font-medium hover:bg-secondary/90"
            onclick={() => (query = "")}
        >
            <Trash2 class="w-4 h-4" />
            Clear
        </button>

        <div
            class="ml-auto text-sm text-muted-foreground flex items-center gap-2"
        >
            {#if executionTime}
                <Clock class="w-4 h-4" />
                {executionTime}
            {/if}
        </div>
    </div>

    <div class="flex flex-1 min-h-0">
        <!-- Editor -->
        <div class="w-1/2 border-r flex flex-col bg-background">
            <textarea
                bind:value={query}
                class="flex-1 w-full p-4 font-mono text-sm resize-none focus:outline-none bg-background text-foreground"
                placeholder="SELECT * FROM my_table WHERE id = 1;"
            ></textarea>
        </div>

        <!-- Results / History -->
        <div class="w-1/2 flex flex-col bg-muted/10 overflow-hidden">
            {#if error}
                <div
                    class="p-4 m-4 bg-destructive/10 text-destructive border border-destructive/20 rounded-md text-sm font-mono whitespace-pre-wrap"
                >
                    {error}
                </div>
            {/if}

            {#if results !== null}
                <div class="flex-1 overflow-auto">
                    <table class="w-full text-sm text-left">
                        <thead
                            class="text-xs uppercase bg-muted text-muted-foreground sticky top-0"
                        >
                            <tr>
                                {#each columns as col}
                                    <th
                                        class="px-4 py-2 border-b whitespace-nowrap"
                                        >{col}</th
                                    >
                                {/each}
                            </tr>
                        </thead>
                        <tbody>
                            {#each results as row}
                                <tr class="border-b hover:bg-muted/50">
                                    {#each columns as col}
                                        <td
                                            class="px-4 py-2 whitespace-nowrap max-w-xs truncate"
                                            title={String(row[col])}
                                        >
                                            {row[col] === null
                                                ? "NULL"
                                                : String(row[col])}
                                        </td>
                                    {/each}
                                </tr>
                            {/each}
                            {#if results.length === 0}
                                <tr>
                                    <td
                                        colspan={columns.length}
                                        class="px-4 py-8 text-center text-muted-foreground"
                                    >
                                        Query returned 0 rows.
                                    </td>
                                </tr>
                            {/if}
                        </tbody>
                    </table>
                </div>
            {:else if !error}
                <!-- History view when no results -->
                <div class="p-4 flex-1 overflow-auto">
                    <h3
                        class="text-sm font-semibold mb-4 text-muted-foreground"
                    >
                        Query History
                    </h3>
                    {#if history.length === 0}
                        <div class="text-sm text-muted-foreground/50 italic">
                            No queries executed yet.
                        </div>
                    {/if}
                    <div class="flex flex-col gap-2">
                        {#each history as item}
                            <div
                                class="p-3 bg-card border rounded-md cursor-pointer hover:border-primary transition-colors"
                                onclick={() => (query = item.query)}
                            >
                                <div class="text-xs text-muted-foreground mb-1">
                                    {item.time}
                                </div>
                                <div class="text-sm font-mono truncate">
                                    {item.query}
                                </div>
                            </div>
                        {/each}
                    </div>
                </div>
            {/if}
        </div>
    </div>
</div>
