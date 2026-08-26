<script lang="ts">
	import { appState as state } from '$lib/state.svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import DataGrid from '$lib/components/DataGrid.svelte';
	import Dashboard from '$lib/components/Dashboard.svelte';
	import ConnectionManager from '$lib/components/ConnectionManager.svelte';
	import SqlEditor from '$lib/components/SqlEditor.svelte';
	import StructureTable from '$lib/components/StructureTable.svelte';
</script>

<div class="flex h-screen w-full overflow-hidden bg-background text-foreground">
	{#if !state.isConnected}
		<div class="m-auto w-full max-w-2xl">
			<ConnectionManager />
		</div>
	{:else}
		<!-- Main App View -->
		<div class="w-64 border-r bg-card flex flex-col">
			<!-- Sidebar Component -->
			<div class="p-4 border-b font-medium flex items-center justify-between">
				<span>Databases</span>
				<button class="text-xs bg-secondary text-secondary-foreground px-2 py-1 rounded hover:opacity-80">Refresh</button>
			</div>
			<div class="flex-1 overflow-auto p-2">
				<Sidebar />
			</div>
		</div>
		
		<div class="flex-1 flex flex-col h-full bg-background overflow-hidden relative">
			<!-- Topbar Component -->
			<header class="h-14 border-b bg-card flex items-center px-4 justify-between shrink-0 shadow-sm">
				<div class="flex items-center gap-2">
					<span class="font-semibold text-lg">{state.currentDatabase || 'Select a Database'}</span>
					{#if state.currentTable}
						<span class="text-muted-foreground">/</span>
						<span class="text-primary font-medium">{state.currentTable}</span>
					{/if}
				</div>
				<div class="flex items-center gap-4 text-sm font-medium">
					<button class="text-muted-foreground hover:text-foreground {state.activeTab === 'query' ? 'text-primary' : ''}" onclick={() => state.activeTab = 'query'}>Query</button>
					{#if state.currentTable}
						<button class="text-muted-foreground hover:text-foreground {state.activeTab === 'data' ? 'text-primary' : ''}" onclick={() => state.activeTab = 'data'}>Data</button>
						<button class="text-muted-foreground hover:text-foreground {state.activeTab === 'structure' ? 'text-primary' : ''}" onclick={() => state.activeTab = 'structure'}>Structure</button>
					{/if}
					<button class="bg-secondary text-secondary-foreground px-3 py-1.5 rounded-md text-xs ml-2 hover:bg-secondary/80 transition-colors">⚙️ Settings</button>
				</div>
			</header>
			
			<!-- Content Component -->
			<main class="flex-1 overflow-hidden">
				{#if state.activeTab === 'query'}
					<SqlEditor />
				{:else if state.activeTab === 'structure' && state.currentTable}
					<StructureTable />
				{:else if state.activeTab === 'data' && state.currentTable}
					<DataGrid />
				{:else if state.activeTab === 'dashboard' && state.currentDatabase}
					<Dashboard />
				{:else}
					<!-- Empty State -->
					<div class="h-full flex items-center justify-center text-muted-foreground p-4">
						Select a database or table to get started
					</div>
				{/if}
			</main>
		</div>
	{/if}
</div>
