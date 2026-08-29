<script lang="ts">
    import { onMount } from "svelte";
    import { fade } from "svelte/transition";

    export let x: number;
    export let y: number;
    export let options: { label: string; icon?: any; action: () => void; class?: string }[];
    export let onClose: () => void;

    let menuElement: HTMLDivElement;

    // Adjust position to stay within screen bounds
    onMount(() => {
        if (menuElement) {
            const rect = menuElement.getBoundingClientRect();
            if (x + rect.width > window.innerWidth) {
                x = window.innerWidth - rect.width - 10;
            }
            if (y + rect.height > window.innerHeight) {
                y = window.innerHeight - rect.height - 10;
            }
        }
    });

    function handleClickOutside(event: MouseEvent) {
        if (menuElement && !menuElement.contains(event.target as Node)) {
            onClose();
        }
    }

    onMount(() => {
        // Use a slight delay so the click that opened the menu doesn't immediately close it
        setTimeout(() => {
            document.addEventListener("click", handleClickOutside);
            document.addEventListener("contextmenu", handleClickOutside);
        }, 10);

        return () => {
            document.removeEventListener("click", handleClickOutside);
            document.removeEventListener("contextmenu", handleClickOutside);
        };
    });

    function handleOptionClick(action: () => void) {
        action();
        onClose();
    }
</script>

<div
    bind:this={menuElement}
    style="left: {x}px; top: {y}px;"
    class="fixed z-[100] min-w-[160px] bg-card border shadow-md rounded-md py-1 overflow-hidden"
    transition:fade={{ duration: 100 }}
>
    {#each options as option}
        <button
            class="w-full text-left px-4 py-2 text-sm flex items-center gap-2 hover:bg-secondary transition-colors {option.class || 'text-foreground'}"
            onclick={() => handleOptionClick(option.action)}
        >
            {#if option.icon}
                <svelte:component this={option.icon} size={14} />
            {/if}
            {option.label}
        </button>
    {/each}
</div>
