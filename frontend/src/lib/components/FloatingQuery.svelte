<script lang="ts">
    import { appState } from '$lib/state.svelte';
    import { socket } from '$lib/services/socket';
    import { X, Play, Maximize2 } from '@lucide/svelte';
    
    // We bind these from the parent or global state
    let { isOpen = $bindable(false), query = $bindable("") } = $props<{ isOpen: boolean, query: string }>();
    
    let isExecuting = $state(false);
    let error = $state("");
    let results: any = $state(null);
    let columns: string[] = $state([]);
    let executionTime = $state("");
    
    let x = $state(window.innerWidth / 2 - 300);
    let y = $state(window.innerHeight / 2 - 200);
    let isDragging = false;
    let startX: number, startY: number, initialX: number, initialY: number;

    function startDrag(e: MouseEvent) {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        initialX = x;
        initialY = y;
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', stopDrag);
    }

    function onDrag(e: MouseEvent) {
        if (!isDragging) return;
        x = initialX + (e.clientX - startX);
        y = initialY + (e.clientY - startY);
    }

    function stopDrag() {
        isDragging = false;
        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('mouseup', stopDrag);
    }

    // Helper to extract rows (similar to what we did elsewhere)
    function extractRows(res: any): any[] {
        const payload = res.result;
        if (!payload) return Array.isArray(res) ? res : [];
        if (payload.type === 'SELECT') {
            return payload.multipleStatements 
                ? (payload.data[payload.data.length - 1]?.data || []) 
                : (payload.data || []);
        } else if (payload.type === 'MODIFY') {
            return [{ Message: payload.message, AffectedRows: payload.affectedRows, InsertID: payload.insertId }];
        }
        return [];
    }

    async function executeQuery() {
        if (!query.trim() || !appState.currentDatabase) return;
        isExecuting = true;
        error = "";
        
        try {
            const data: any = await new Promise((resolve, reject) => {
                const onResult = (data: any) => { cleanup(); resolve(data); };
                const onError = (data: any) => { cleanup(); reject(data.message || "Unknown error"); };
                const cleanup = () => {
                    socket.off("query_result", onResult);
                    socket.off("query_execution_error", onError);
                };
                socket.on("query_result", onResult);
                socket.on("query_execution_error", onError);
                socket.emit("execute_query", { database: appState.currentDatabase, query });
            });
            
            const fetched = extractRows(data);
            results = fetched;
            columns = results.length > 0 ? Object.keys(results[0]) : [];
            const payload = data.result;
            executionTime = `Executed in ${data.time || "0ms"}`;
            if (payload && payload.type === 'SELECT') {
                executionTime += `, ${payload.rowCount || 0} rows`;
            }
        } catch (e: any) {
            error = e.toString();
            results = null;
            columns = [];
        } finally {
            isExecuting = false;
        }
    }
    
    function goToEditor() {
        appState.activeTab = 'query';
        isOpen = false;
    }
</script>

{#if isOpen}
    <div 
        class="fixed z-[100] bg-background border rounded-lg shadow-2xl flex flex-col overflow-hidden resize"
        style="width: 600px; height: 400px; top: {y}px; left: {x}px; min-width: 400px; min-height: 300px;"
    >
        <div 
            class="h-10 bg-muted border-b flex items-center justify-between px-3 shrink-0"
        >
            <div 
                class="font-medium text-sm flex-1 cursor-move h-full flex items-center"
                onmousedown={startDrag}
                role="dialog"
                tabindex="0"
            >Floating Query</div>
            <div class="flex items-center gap-1">
                <button class="p-1 hover:bg-muted-foreground/20 rounded text-muted-foreground hover:text-foreground transition-colors" onclick={goToEditor} title="Open in Full Editor">
                    <Maximize2 class="w-4 h-4" />
                </button>
                <button class="p-1 hover:bg-muted-foreground/20 rounded text-muted-foreground hover:text-foreground transition-colors" onclick={() => isOpen = false}>
                    <X class="w-4 h-4" />
                </button>
            </div>
        </div>
        
        <div class="flex flex-col flex-1 min-h-0">
            <div class="p-2 border-b bg-card">
                <textarea 
                    bind:value={query} 
                    class="w-full bg-transparent border border-input rounded p-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary resize-y"
                    rows="4"
                ></textarea>
                <div class="flex justify-between items-center mt-2">
                    <span class="text-xs text-muted-foreground">{executionTime}</span>
                    <button 
                        class="flex items-center gap-2 px-3 py-1 bg-primary text-primary-foreground rounded-md text-sm hover:opacity-90 disabled:opacity-50"
                        onclick={executeQuery}
                        disabled={isExecuting}
                    >
                        <Play class="w-4 h-4" />
                        {isExecuting ? 'Executing...' : 'Run Query'}
                    </button>
                </div>
            </div>
            
            <div class="flex-1 overflow-auto bg-muted/10 p-2 relative">
                {#if error}
                    <div class="p-3 bg-destructive/10 text-destructive text-sm rounded border border-destructive/20 font-mono whitespace-pre-wrap">
                        {error}
                    </div>
                {:else if results !== null}
                    <table class="w-full text-sm text-left">
                        <thead class="text-xs uppercase bg-muted text-muted-foreground sticky top-0">
                            <tr>
                                {#each columns as col}
                                    <th class="px-3 py-2 border-b whitespace-nowrap">{col}</th>
                                {/each}
                            </tr>
                        </thead>
                        <tbody>
                            {#each results as row}
                                <tr class="border-b hover:bg-muted/50">
                                    {#each columns as col}
                                        <td class="px-3 py-1.5 whitespace-nowrap max-w-xs truncate" title={String(row[col])}>
                                            {row[col] === null ? "NULL" : String(row[col])}
                                        </td>
                                    {/each}
                                </tr>
                            {/each}
                            {#if results.length === 0}
                                <tr>
                                    <td colspan={columns.length} class="px-4 py-8 text-center text-muted-foreground">0 rows.</td>
                                </tr>
                            {/if}
                        </tbody>
                    </table>
                {/if}
            </div>
        </div>
    </div>
{/if}
