<script lang="ts">
    import { onMount } from "svelte";
    import { socket } from "$lib/services/socket";
    import { api } from "$lib/services/api";
    import { appState } from "$lib/state.svelte";
    import { Database, Server, Key, Save, Play, Trash2, Settings2 } from "@lucide/svelte";
    import type { ServerConnection } from "$lib/types";

    let savedConnections = $state<ServerConnection[]>([]);
    let selectedConnectionId = $state<string>("");

    let engine = $state<"mysql" | "postgresql">("mysql");
    let host = $state("localhost");
    let port = $state(3306);
    let user = $state("root");
    let password = $state("");
    let database = $state("");

    let showAdvanced = $state(false);
    let sslCa = $state("");
    let sslCert = $state("");
    let sslKey = $state("");
    let rejectUnauthorized = $state(true);

    let saveConnection = $state(false);
    let saveLocation = $state<"local" | "server">("local");
    let ipRestriction = $state<"all" | "current" | "selected">("current");

    let isConnecting = $state(false);
    let connectionError = $state("");

    onMount(() => {
        loadConnections();

        // Listen for socket connection status
        socket.on("connection_success", (msg) => {
            isConnecting = false;
            appState.isConnected = true;
            // The socket 'settings_data' will follow which updates settings
        });

        socket.on("connection_error", (msg) => {
            isConnecting = false;
            connectionError = typeof msg === 'object' ? (msg.error || msg.message || JSON.stringify(msg)) : msg;
        });

        return () => {
            socket.off("connection_success");
            socket.off("connection_error");
        };
    });

    async function loadConnections() {
        try {
            // Load server-saved connections
            const serverRes = await api.get<{
                status: string;
                connections: Record<string, ServerConnection>;
            }>("/connections/list");
            let list: ServerConnection[] = [];
            if (serverRes.connections) {
                list = Object.entries(serverRes.connections).map(([id, c]) => ({
                    ...c,
                    _id: id,
                    _location: "server"
                }));
            }

            // Load locally-saved connections
            const localRaw = localStorage.getItem("db_manager_connections");
            if (localRaw) {
                try {
                    const localList = JSON.parse(localRaw);
                    list = [...list, ...localList];
                } catch (e) {}
            }

            savedConnections = list;
        } catch (err) {
            console.error("Failed to load connections", err);
        }
    }

    function handleSelectConnection() {
        if (!selectedConnectionId) return;
        const conn = savedConnections.find(
            (c) => c._id === selectedConnectionId,
        );
        if (conn) {
            engine = conn.engine || "mysql";
            host = conn.host || "localhost";
            port = conn.port || (engine === "mysql" ? 3306 : 5432);
            user = conn.user || "";
            password = conn.password || "";
            database = conn.database || "";
            sslCa = conn.sslCa || "";
            sslCert = conn.sslCert || "";
            sslKey = conn.sslKey || "";
            rejectUnauthorized = conn.rejectUnauthorized !== false;
            if (sslCa || sslCert || sslKey) {
                showAdvanced = true;
            }
        }
    }

    async function deleteConnection(id: string) {
        if (!confirm("Delete this connection?")) return;
        const conn = savedConnections.find((c) => c._id === id);
        if (!conn) return;

        if (conn._location === "server") {
            try {
                await api.delete(
                    `/connections/delete?id=${encodeURIComponent(id)}`,
                );
            } catch (err: any) {
                alert("Failed to delete from server: " + err.message);
                return;
            }
        } else {
            const localRaw = localStorage.getItem("db_manager_connections");
            if (localRaw) {
                let localList: ServerConnection[] = JSON.parse(localRaw);
                localList = localList.filter((c) => c._id !== id);
                localStorage.setItem(
                    "db_manager_connections",
                    JSON.stringify(localList),
                );
            }
        }
        await loadConnections();
        selectedConnectionId = "";
    }

    async function handleConnect(e: Event) {
        e.preventDefault();
        connectionError = "";
        isConnecting = true;

        const payload: ServerConnection = {
            engine,
            host,
            port,
            user,
            password,
            database,
            sslCa: sslCa || undefined,
            sslCert: sslCert || undefined,
            sslKey: sslKey || undefined,
            rejectUnauthorized,
            ipRestriction,
        };

        if (saveConnection) {
            payload._id = "conn_" + Date.now();
            payload._location = saveLocation;

            if (saveLocation === "server") {
                try {
                    await api.post("/connections/save", {
                        id: payload._id,
                        connection: payload
                    });
                } catch (err: any) {
                    connectionError =
                        "Failed to save connection to server: " + err.message;
                    isConnecting = false;
                    return;
                }
            } else {
                const localRaw = localStorage.getItem("db_manager_connections");
                let localList: ServerConnection[] = [];
                if (localRaw) {
                    try {
                        localList = JSON.parse(localRaw);
                    } catch (e) {}
                }
                localList.push(payload);
                localStorage.setItem(
                    "db_manager_connections",
                    JSON.stringify(localList),
                );
            }
            await loadConnections();
        }

        appState.currentCredentials = payload;
        isConnecting = true;
        connectionError = "";
        socket.emit("connect_database", payload);
    }

    function setEngine(e: "mysql" | "postgresql") {
        engine = e;
        if (e === "mysql" && port === 5432) port = 3306;
        if (e === "postgresql" && port === 3306) port = 5432;
    }
</script>

<div class="m-auto w-full max-w-2xl p-8 bg-card/80 backdrop-blur-xl rounded-2xl border shadow-[0_8px_30px_rgb(0,0,0,0.12)] flex flex-col gap-6 transition-all">
    <div class="flex flex-col items-center gap-3 mb-4 text-primary">
        <div class="p-4 bg-gradient-to-br from-primary/20 to-primary/5 rounded-2xl shadow-inner border border-primary/10">
            <Database class="w-10 h-10 text-primary drop-shadow-md" />
        </div>
        <h1 class="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-primary to-primary/60">DB Manager</h1>
        <p class="text-sm font-medium text-muted-foreground">Securely connect to your database</p>
    </div>

    {#if connectionError}
        <div
            class="p-3 bg-destructive/10 text-destructive rounded-md border border-destructive/20 text-sm"
        >
            {connectionError}
        </div>
    {/if}

    {#if savedConnections.length > 0}
        <div class="flex flex-col gap-2 p-4 bg-muted/50 rounded-lg border">
            <label class="text-sm font-medium text-foreground"
                >Saved Connections</label
            >
            <div class="flex gap-2">
                <select
                    bind:value={selectedConnectionId}
                    onchange={handleSelectConnection}
                    class="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <option value="">-- Select a connection --</option>
                    {#each savedConnections as conn}
                        <option value={conn._id}>
                            {conn.user}@{conn.host}:{conn.port}
                            {conn.database ? `(${conn.database})` : ""} [{conn.engine}]
                        </option>
                    {/each}
                </select>
                {#if selectedConnectionId}
                    <button
                        type="button"
                        class="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-destructive hover:text-destructive-foreground h-10 px-4 py-2"
                        onclick={() => deleteConnection(selectedConnectionId)}
                    >
                        <Trash2 class="w-4 h-4" />
                    </button>
                {/if}
            </div>
        </div>
    {/if}

    <form onsubmit={handleConnect} class="flex flex-col gap-5">
        <!-- Engine selection -->
        <div class="flex gap-2 p-1 bg-muted rounded-lg w-full">
            <button
                type="button"
                class="flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all {engine ===
                'mysql'
                    ? 'bg-background shadow-sm text-foreground'
                    : 'text-muted-foreground hover:bg-background/50'}"
                onclick={() => setEngine("mysql")}
            >
                MySQL
            </button>
            <button
                type="button"
                class="flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all {engine ===
                'postgresql'
                    ? 'bg-background shadow-sm text-foreground'
                    : 'text-muted-foreground hover:bg-background/50'}"
                onclick={() => setEngine("postgresql")}
            >
                PostgreSQL
            </button>
        </div>

        <div class="grid grid-cols-4 gap-4">
            <div class="col-span-3 flex flex-col gap-2">
                <label class="text-sm font-medium leading-none">Host</label>
                <div class="relative">
                    <Server
                        class="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"
                    />
                    <input
                        type="text"
                        bind:value={host}
                        class="flex h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        placeholder="localhost"
                        required
                    />
                </div>
            </div>
            <div class="col-span-1 flex flex-col gap-2">
                <label class="text-sm font-medium leading-none">Port</label>
                <input
                    type="number"
                    bind:value={port}
                    class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="3306"
                    required
                />
            </div>
        </div>

        <div class="grid grid-cols-2 gap-4">
            <div class="flex flex-col gap-2">
                <label class="text-sm font-medium leading-none">User</label>
                <input
                    type="text"
                    bind:value={user}
                    class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="root"
                    required
                />
            </div>
            <div class="flex flex-col gap-2">
                <label class="text-sm font-medium leading-none">Password</label>
                <div class="relative">
                    <Key
                        class="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"
                    />
                    <input
                        type="password"
                        bind:value={password}
                        class="flex h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        placeholder="••••••••"
                    />
                </div>
            </div>
        </div>

        <div class="flex flex-col gap-2">
            <label class="text-sm font-medium leading-none"
                >Database (Optional)</label
            >
            <input
                type="text"
                bind:value={database}
                class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Database name"
            />
        </div>

        <!-- Advanced SSL -->
        <div class="flex flex-col gap-2 border rounded-md p-4 bg-card">
            <button
                type="button"
                class="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors"
                onclick={() => (showAdvanced = !showAdvanced)}
            >
                <Settings2 class="w-4 h-4" />
                Advanced SSL Options {showAdvanced ? "▼" : "▶"}
            </button>

            {#if showAdvanced}
                <div class="mt-4 flex flex-col gap-4">
                    <div class="flex flex-col gap-2">
                        <label
                            class="text-sm font-medium leading-none text-muted-foreground"
                            >SSL CA Certificate</label
                        >
                        <textarea
                            bind:value={sslCa}
                            class="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            placeholder="-----BEGIN CERTIFICATE-----"
                        ></textarea>
                    </div>
                    <div class="flex flex-col gap-2">
                        <label
                            class="text-sm font-medium leading-none text-muted-foreground"
                            >SSL Client Certificate</label
                        >
                        <textarea
                            bind:value={sslCert}
                            class="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            placeholder="-----BEGIN CERTIFICATE-----"
                        ></textarea>
                    </div>
                    <div class="flex flex-col gap-2">
                        <label
                            class="text-sm font-medium leading-none text-muted-foreground"
                            >SSL Client Key</label
                        >
                        <textarea
                            bind:value={sslKey}
                            class="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            placeholder="-----BEGIN PRIVATE KEY-----"
                        ></textarea>
                    </div>
                    <label
                        class="flex items-center gap-2 text-sm text-foreground cursor-pointer"
                    >
                        <input
                            type="checkbox"
                            bind:checked={rejectUnauthorized}
                            class="rounded border-input text-primary focus:ring-primary"
                        />
                        Reject Unauthorized (Verify Server Certificate)
                    </label>
                </div>
            {/if}
        </div>

        <div class="flex flex-col gap-3">
            <label
                class="flex items-center gap-2 text-sm font-medium cursor-pointer"
            >
                <input
                    type="checkbox"
                    bind:checked={saveConnection}
                    class="rounded border-input text-primary focus:ring-primary h-4 w-4"
                />
                Save this connection
            </label>

            {#if saveConnection}
                <div class="flex flex-col gap-3 pl-6">
                    <div class="flex gap-4">
                        <label
                            class="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                        >
                            <input
                                type="radio"
                                bind:group={saveLocation}
                                value="local"
                                class="text-primary focus:ring-primary"
                            />
                            Local Storage
                        </label>
                        <label
                            class="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                        >
                            <input
                                type="radio"
                                bind:group={saveLocation}
                                value="server"
                                class="text-primary focus:ring-primary"
                            />
                            Server DB
                        </label>
                    </div>

                    {#if saveLocation === "server"}
                        <div class="flex flex-col gap-2 mt-2">
                            <label class="text-sm font-medium leading-none text-muted-foreground">IP Restriction</label>
                            <select
                                bind:value={ipRestriction}
                                class="flex h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            >
                                <option value="current">Only allow my current IP</option>
                                <option value="all">Allow all IPs</option>
                            </select>
                        </div>
                    {/if}
                </div>
            {/if}
        </div>

        <button
            type="submit"
            disabled={isConnecting}
            class="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-11 mt-2"
        >
            {#if isConnecting}
                <div
                    class="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-r-transparent mr-2"
                ></div>
                Connecting...
            {:else}
                <Play class="w-4 h-4 mr-2" />
                Connect to Database
            {/if}
        </button>
    </form>
</div>
