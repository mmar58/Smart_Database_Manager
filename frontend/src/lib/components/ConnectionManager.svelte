<script lang="ts">
    import { onMount } from "svelte";
    import { socket } from "$lib/services/socket";
    import { api } from "$lib/services/api";
    import { appState } from "$lib/state.svelte";
    import { Database, Play } from "@lucide/svelte";
    import type { ServerConnection } from "$lib/types";

    // Modular connection components
    import SavedConnections from "./Connection/SavedConnections.svelte";
    import EngineSelector from "./Connection/EngineSelector.svelte";
    import CredentialsForm from "./Connection/CredentialsForm.svelte";
    import SslOptions from "./Connection/SslOptions.svelte";
    import SaveOptions from "./Connection/SaveOptions.svelte";

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
    let currentIp = $state("");
    let selectedIpsText = $state("");

    let isConnecting = $state(false);
    let connectionError = $state("");

    onMount(() => {
        loadConnections();

        api.get<{ ip: string }>("/my-ip")
            .then((res) => {
                if (res && res.ip) currentIp = res.ip;
            })
            .catch((err) => console.error("Failed to fetch IP", err));

        // Listen for socket connection status
        socket.on("connection_success", (msg) => {
            isConnecting = false;
            appState.isConnected = true;
            // The socket 'settings_data' will follow which updates settings
        });

        socket.on("connection_error", (msg) => {
            isConnecting = false;
            connectionError =
                typeof msg === "object"
                    ? msg.error || msg.message || JSON.stringify(msg)
                    : msg;
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
            console.log(serverRes);
            let list: ServerConnection[] = [];
            if (serverRes.connections) {
                list = Object.entries(serverRes.connections).map(([id, c]) => ({
                    ...c,
                    _id: id,
                    _location: "server",
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
            ipRestriction = conn.ipRestriction || "current";
            selectedIpsText = (conn.selectedIps || []).join(", ");
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
            selectedIps:
                ipRestriction === "selected"
                    ? selectedIpsText
                          .split(",")
                          .map((ip) => ip.trim())
                          .filter(Boolean)
                    : undefined,
        };

        if (saveConnection) {
            payload._id = "conn_" + Date.now();
            payload._location = saveLocation;

            if (saveLocation === "server") {
                try {
                    await api.post("/connections/save", {
                        id: payload._id,
                        connection: payload,
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

<div
    class="m-auto w-full max-w-2xl p-8 bg-card/80 backdrop-blur-xl rounded-2xl border shadow-[0_8px_30px_rgb(0,0,0,0.12)] flex flex-col gap-6 transition-all"
>
    <div class="flex flex-col items-center gap-3 mb-4 text-primary">
        <div
            class="p-4 bg-gradient-to-br from-primary/20 to-primary/5 rounded-2xl shadow-inner border border-primary/10"
        >
            <Database class="w-10 h-10 text-primary drop-shadow-md" />
        </div>
        <h1
            class="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-primary to-primary/60"
        >
            DB Manager
        </h1>
        <p class="text-sm font-medium text-muted-foreground">
            Securely connect to your database
        </p>
    </div>

    {#if connectionError}
        <div
            class="p-3 bg-destructive/10 text-destructive rounded-md border border-destructive/20 text-sm"
        >
            {connectionError}
        </div>
    {/if}

    <SavedConnections
        {savedConnections}
        bind:selectedConnectionId
        onSelect={handleSelectConnection}
        onDelete={deleteConnection}
        onManage={() => (appState.isConnectionManagerOpen = true)}
    />

    <form onsubmit={handleConnect} class="flex flex-col gap-5">
        <EngineSelector bind:engine onChange={setEngine} />

        <CredentialsForm
            bind:host
            bind:port
            bind:user
            bind:password
            bind:database
            {engine}
        />

        <SslOptions
            bind:showAdvanced
            bind:sslCa
            bind:sslCert
            bind:sslKey
            bind:rejectUnauthorized
        />

        <SaveOptions
            bind:saveConnection
            bind:saveLocation
            bind:ipRestriction
            {currentIp}
            bind:selectedIpsText
        />

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
