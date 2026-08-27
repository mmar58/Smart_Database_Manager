<script lang="ts">
	import { appState } from "$lib/state.svelte";
	import Sidebar from "$lib/components/Sidebar.svelte";
	import DataGrid from "$lib/components/DataGrid.svelte";
	import Dashboard from "$lib/components/Dashboard.svelte";
	import ConnectionManager from "$lib/components/ConnectionManager.svelte";
	import SqlEditor from "$lib/components/SqlEditor.svelte";
	import StructureTable from "$lib/components/StructureTable.svelte";
	import SettingsModal from "$lib/components/SettingsModal.svelte";
	import OllamaChat from "$lib/components/OllamaChat.svelte";
	import { initSettings } from "$lib/state.svelte";
	import { Bot } from "@lucide/svelte";
	import { onMount } from "svelte";

	let isSettingsOpen = $state(false);

	onMount(() => {
		initSettings();
	});
</script>

<SettingsModal bind:isOpen={isSettingsOpen} />

<div class="flex h-screen w-full overflow-hidden bg-background text-foreground">
	{#if !appState.isConnected}
		<div class="w-full h-full overflow-y-auto">
			<div class="min-h-full flex flex-col justify-center py-8 px-4">
				<div class="mx-auto w-full max-w-2xl">
					<ConnectionManager />
				</div>
			</div>
		</div>
	{:else}
		<!-- Main App View -->
		<div class="w-64 border-r bg-card flex flex-col">
			<!-- Sidebar Component -->
			<div
				class="p-4 border-b font-medium flex items-center justify-between"
			>
				<span>Databases</span>
				<button
					class="text-xs bg-secondary text-secondary-foreground px-2 py-1 rounded hover:opacity-80"
					>Refresh</button
				>
			</div>
			<div class="flex-1 overflow-auto p-2">
				<Sidebar />
			</div>
		</div>

		<div
			class="flex-1 flex flex-col h-full bg-background overflow-hidden relative"
		>
			<!-- Topbar Component -->
			<header
				class="h-14 border-b bg-card flex items-center px-4 justify-between shrink-0 shadow-sm"
			>
				<div class="flex items-center gap-2">
					<span class="font-semibold text-lg"
						>{appState.currentDatabase || "Select a Database"}</span
					>
					{#if appState.currentTable}
						<span class="text-muted-foreground">/</span>
						<span class="text-primary font-medium"
							>{appState.currentTable}</span
						>
					{/if}
				</div>
				<div class="flex items-center gap-4 text-sm font-medium">
					<button
						class="text-muted-foreground hover:text-foreground {appState.activeTab ===
						'query'
							? 'text-primary'
							: ''}"
						onclick={() => (appState.activeTab = "query")}
						>Query</button
					>
					{#if appState.currentTable}
						<button
							class="text-muted-foreground hover:text-foreground {appState.activeTab ===
							'data'
								? 'text-primary'
								: ''}"
							onclick={() => (appState.activeTab = "data")}
							>Data</button
						>
						<button
							class="text-muted-foreground hover:text-foreground {appState.activeTab ===
							'structure'
								? 'text-primary'
								: ''}"
							onclick={() => (appState.activeTab = "structure")}
							>Structure</button
						>
					{/if}
					<button
						class="flex items-center gap-2 px-3 py-1.5 ml-2 {appState.ollama.isOpen ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'} rounded-md text-sm font-medium hover:opacity-90"
						onclick={() => (appState.ollama.isOpen = !appState.ollama.isOpen)}
					>
						<Bot class="w-4 h-4" />
						Ollama Assistant
					</button>
					<button
						class="bg-secondary text-secondary-foreground px-3 py-1.5 rounded-md text-xs ml-2 hover:bg-secondary/80 transition-colors"
						onclick={() => (isSettingsOpen = true)}
						>⚙️ Settings</button
					>
				</div>
			</header>

			<!-- Content Component -->
			<main class="flex-1 overflow-hidden relative">
				<OllamaChat />
				{#if appState.activeTab === "query"}
					<SqlEditor />
				{:else if appState.activeTab === "structure" && appState.currentTable}
					<StructureTable />
				{:else if appState.activeTab === "data" && appState.currentTable}
					<DataGrid />
				{:else if appState.activeTab === "dashboard" && appState.currentDatabase}
					<Dashboard />
				{:else}
					<!-- Empty State -->
					<div
						class="h-full flex items-center justify-center text-muted-foreground p-4"
					>
						Select a database or table to get started
					</div>
				{/if}
			</main>
		</div>
	{/if}
</div>
