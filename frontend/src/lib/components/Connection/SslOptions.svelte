<script lang="ts">
    import { Settings2 } from "@lucide/svelte";
    
    /** Toggle state for showing the advanced SSL fields */
    export let showAdvanced = false;
    /** Bound boolean to enable SSL explicitly */
    export let enableSsl = false;
    /** Bound Certificate Authority content */
    export let sslCa = "";
    /** Bound Client Certificate content */
    export let sslCert = "";
    /** Bound Client Key content */
    export let sslKey = "";
    /** Bound boolean to reject unauthorized server certs */
    export let rejectUnauthorized = false;
</script>

<div class="flex flex-col gap-2 border rounded-md p-4 bg-card">
    <label class="flex items-center gap-2 text-sm font-medium text-foreground cursor-pointer w-fit pb-2">
        <input
            type="checkbox"
            bind:checked={enableSsl}
            class="rounded border-input text-primary focus:ring-primary"
        />
        Enable SSL Connection
    </label>

    <button
        type="button"
        class="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors text-left border-t pt-2"
        onclick={() => (showAdvanced = !showAdvanced)}
    >
        <Settings2 class="w-4 h-4" />
        Advanced SSL Options {showAdvanced ? "▼" : "▶"}
    </button>

    {#if showAdvanced}
        <div class="mt-4 flex flex-col gap-4">
            <div class="flex flex-col gap-2">
                <label for="sslCa" class="text-sm font-medium leading-none text-muted-foreground">SSL CA Certificate</label>
                <textarea
                    id="sslCa"
                    bind:value={sslCa}
                    class="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="-----BEGIN CERTIFICATE-----"
                ></textarea>
            </div>
            <div class="flex flex-col gap-2">
                <label for="sslCert" class="text-sm font-medium leading-none text-muted-foreground">SSL Client Certificate</label>
                <textarea
                    id="sslCert"
                    bind:value={sslCert}
                    class="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="-----BEGIN CERTIFICATE-----"
                ></textarea>
            </div>
            <div class="flex flex-col gap-2">
                <label for="sslKey" class="text-sm font-medium leading-none text-muted-foreground">SSL Client Key</label>
                <textarea
                    id="sslKey"
                    bind:value={sslKey}
                    class="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="-----BEGIN PRIVATE KEY-----"
                ></textarea>
            </div>
            <label class="flex items-center gap-2 text-sm text-foreground cursor-pointer w-fit">
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
