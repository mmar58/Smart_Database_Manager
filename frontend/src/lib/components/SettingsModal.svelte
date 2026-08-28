<script lang="ts">
    import Modal from './Modal.svelte';
    import { appState, saveSettings } from '$lib/state.svelte';
    import { Save } from '@lucide/svelte';

    let { isOpen = $bindable(false) } = $props<{ isOpen: boolean }>();

    let ollamaApiUrl = $state(appState.settings?.ollamaApiUrl || 'http://localhost:11434');
    let theme = $state(appState.settings?.theme || 'dark');

    function save() {
        saveSettings({
            ollamaApiUrl,
            theme
        });
        isOpen = false;
    }

    $effect(() => {
        if (isOpen) {
            ollamaApiUrl = appState.settings?.ollamaApiUrl || 'http://localhost:11434';
            theme = appState.settings?.theme || 'dark';
        }
    });
</script>

<Modal bind:isOpen title="Settings">
    <div class="space-y-4">
        <div class="flex flex-col gap-1.5">
            <label class="text-sm font-medium">Theme</label>
            <select bind:value={theme} class="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                <option value="dark">Dark</option>
                <option value="light">Light</option>
            </select>
        </div>

        <div class="flex flex-col gap-1.5">
            <label class="text-sm font-medium">Ollama API URL</label>
            <input 
                type="text" 
                bind:value={ollamaApiUrl} 
                class="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" 
                placeholder="http://localhost:11434"
            />
            <p class="text-xs text-muted-foreground">URL of the local or remote Ollama instance. E.g. http://127.0.0.1:11434</p>
        </div>

        <div class="flex justify-end pt-4">
            <button 
                class="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4 py-2"
                onclick={save}
            >
                <Save class="w-4 h-4 mr-2" />
                Save Settings
            </button>
        </div>
    </div>
</Modal>
