<script lang="ts">
    import { Server, Key } from "@lucide/svelte";
    
    /** Bound host address */
    export let host = "localhost";
    /** Bound port number */
    export let port = 3306;
    /** Bound username */
    export let user = "root";
    /** Bound password */
    export let password = "";
    /** Bound database name */
    export let database = "";
    /** Selected engine */
    export let engine = "mysql";
</script>

<div class="grid grid-cols-4 gap-4">
    <div class="col-span-3 flex flex-col gap-2">
        <label for="host" class="text-sm font-medium leading-none">Host</label>
        <div class="relative">
            <Server class="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
                id="host"
                type="text"
                bind:value={host}
                class="flex h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="localhost"
                required
            />
        </div>
    </div>
    <div class="col-span-1 flex flex-col gap-2">
        <label for="port" class="text-sm font-medium leading-none">Port</label>
        <input
            id="port"
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
        <label for="user" class="text-sm font-medium leading-none">User</label>
        <input
            id="user"
            type="text"
            bind:value={user}
            class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            placeholder="root"
            required
        />
    </div>
    <div class="flex flex-col gap-2">
        <label for="password" class="text-sm font-medium leading-none">Password</label>
        <div class="relative">
            <Key class="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
                id="password"
                type="password"
                bind:value={password}
                class="flex h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="••••••••"
            />
        </div>
    </div>
</div>

<div class="flex flex-col gap-2">
    <label for="database" class="text-sm font-medium leading-none">Database (Optional)</label>
    <input
        id="database"
        type="text"
        bind:value={database}
        class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        placeholder={engine === "postgresql" ? "postgres" : "Database name"}
    />
</div>
