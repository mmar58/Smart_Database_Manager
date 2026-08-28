<script lang="ts">
    import { X } from '@lucide/svelte';
    
    let { isOpen = $bindable(false), title, children } = $props<{
        isOpen: boolean,
        title: string,
        children: any
    }>();
</script>

{#if isOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div 
        class="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center animate-in fade-in-0"
        onclick={() => isOpen = false}
    >
        <div 
            class="bg-card w-full max-w-lg border rounded-lg shadow-lg flex flex-col animate-in zoom-in-95"
            onclick={(e) => e.stopPropagation()}
        >
            <div class="flex items-center justify-between p-4 border-b">
                <h3 class="font-semibold text-lg">{title}</h3>
                <button 
                    class="p-1 rounded-md hover:bg-secondary text-muted-foreground transition-colors"
                    onclick={() => isOpen = false}
                >
                    <X size={16} />
                </button>
            </div>
            <div class="p-4 overflow-y-auto max-h-[70vh]">
                {@render children()}
            </div>
        </div>
    </div>
{/if}
