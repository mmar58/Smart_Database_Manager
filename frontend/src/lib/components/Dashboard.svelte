<script lang="ts">
    import { appState } from "$lib/state.svelte";
    import { socket } from "$lib/services/socket";
    import { Database, Table, HardDrive } from "@lucide/svelte";

    let sizes: any[] = $state([]);
    let totalMb = $state(0);

    let expandedDb = $state<string | null>(null);
    let tableSizes = $state<Record<string, { table: string, sizeMb: string }[]>>({});

    function toggleDb(dbName: string) {
        if (expandedDb === dbName) {
            expandedDb = null;
        } else {
            expandedDb = dbName;
            if (!tableSizes[dbName]) {
                socket.emit("get_table_sizes", dbName);
            }
        }
    }

    $effect(() => {
        socket.on("db_sizes", (data: any[]) => {
            sizes = data;
            totalMb = sizes.reduce(
                (a: number, s: any) => a + (parseFloat(s.sizeMb) || 0),
                0,
            );
        });

        socket.on("table_sizes", (data: { database: string, sizes: any[] }) => {
            tableSizes[data.database] = data.sizes;
        });

        // Request sizes on mount if we have a connection
        if (appState.isConnected) {
            socket.emit("get_db_sizes");
        }

        return () => {
            socket.off("db_sizes");
            socket.off("table_sizes");
        };
    });
</script>

<div class="h-full flex flex-col gap-6 p-6 max-w-5xl mx-auto w-full">
    <div class="flex items-center gap-3">
        <h2 class="text-2xl font-semibold tracking-tight">System Overview</h2>
    </div>

    <!-- Stats -->
    <div class="grid grid-cols-3 gap-4">
        <div
            class="bg-card border rounded-xl p-4 shadow-sm flex flex-col gap-2 relative overflow-hidden"
        >
            <Database
                class="absolute -bottom-4 -right-4 w-24 h-24 text-primary/10"
            />
            <div class="text-muted-foreground text-sm font-medium">
                Total Databases
            </div>
            <div class="text-3xl font-bold">{sizes.length}</div>
        </div>
        <div
            class="bg-card border rounded-xl p-4 shadow-sm flex flex-col gap-2 relative overflow-hidden"
        >
            <Table
                class="absolute -bottom-4 -right-4 w-24 h-24 text-success/10"
            />
            <div class="text-muted-foreground text-sm font-medium">
                Total Tables
            </div>
            <div class="text-3xl font-bold">-</div>
        </div>
        <div
            class="bg-card border rounded-xl p-4 shadow-sm flex flex-col gap-2 relative overflow-hidden"
        >
            <HardDrive
                class="absolute -bottom-4 -right-4 w-24 h-24 text-accent/10"
            />
            <div class="text-muted-foreground text-sm font-medium">
                Total Size
            </div>
            <div class="text-3xl font-bold">{totalMb.toFixed(1)} MB</div>
        </div>
    </div>

    <!-- Database Sizes -->
    <div class="bg-card border rounded-xl shadow-sm flex flex-col flex-1 min-h-0">
        <div class="p-4 border-b font-semibold flex-shrink-0">Database Sizes</div>
        <div class="p-4 flex flex-col gap-3 overflow-y-auto min-h-0">
            {#if sizes.length === 0}
                <div class="text-muted-foreground text-sm italic">
                    Loading size data...
                </div>
            {/if}
            {#each sizes as db}
                <div class="flex flex-col border-b last:border-0 pb-2 mb-2 last:pb-0 last:mb-0">
                    <button 
                        class="flex items-center gap-4 text-sm hover:bg-muted/30 p-2 rounded transition-colors w-full text-left"
                        onclick={() => toggleDb(db.database)}
                    >
                        <div
                            class="w-1/3 truncate font-medium flex items-center gap-2"
                        >
                            <Database size={14} class="text-primary" />
                            {db.database}
                        </div>
                        <div
                            class="flex-1 bg-secondary rounded-full h-2 overflow-hidden"
                        >
                            <div
                                class="bg-primary h-full transition-all duration-500"
                                style="width: {Math.max(...sizes.map((s: any) => parseFloat(s.sizeMb) || 0)) > 0
                                    ? (parseFloat(db.sizeMb) / Math.max(...sizes.map((s: any) => parseFloat(s.sizeMb) || 0))) * 100
                                    : 0}%"
                            ></div>
                        </div>
                        <div
                            class="w-24 text-right tabular-nums text-muted-foreground font-medium"
                        >
                            {db.sizeMb} MB
                        </div>
                    </button>

                    {#if expandedDb === db.database}
                        <div class="ml-6 mt-2 pl-4 border-l flex flex-col gap-2">
                            {#if !tableSizes[db.database]}
                                <div class="text-xs text-muted-foreground italic p-2">Loading tables...</div>
                            {:else if tableSizes[db.database].length === 0}
                                <div class="text-xs text-muted-foreground italic p-2">No tables found.</div>
                            {:else}
                                {#each [...tableSizes[db.database]].sort((a, b) => parseFloat(b.sizeMb) - parseFloat(a.sizeMb)) as table}
                                    <div class="flex items-center gap-4 text-xs p-1 rounded hover:bg-muted/20">
                                        <div class="w-1/3 truncate flex items-center gap-2">
                                            <Table size={12} class="text-success" />
                                            <span class="text-muted-foreground">{table.table}</span>
                                        </div>
                                        <div class="flex-1 bg-secondary rounded-full h-1.5 overflow-hidden">
                                            <div
                                                class="bg-success/70 h-full transition-all duration-500"
                                                style="width: {Math.max(...tableSizes[db.database].map((s: any) => parseFloat(s.sizeMb) || 0)) > 0
                                                    ? (parseFloat(table.sizeMb) / Math.max(...tableSizes[db.database].map((s: any) => parseFloat(s.sizeMb) || 0))) * 100
                                                    : 0}%"
                                            ></div>
                                        </div>
                                        <div class="w-24 text-right tabular-nums text-muted-foreground/70">
                                            {table.sizeMb} MB
                                        </div>
                                    </div>
                                {/each}
                            {/if}
                        </div>
                    {/if}
                </div>
            {/each}
        </div>
    </div>
</div>
