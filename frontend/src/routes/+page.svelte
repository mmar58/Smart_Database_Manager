<script lang="ts">
	import { appState } from "$lib/state.svelte";
	import { socket } from "$lib/services/socket";
	import Sidebar from "$lib/components/Sidebar.svelte";
	import DataGrid from "$lib/components/DataGrid.svelte";
	import Dashboard from "$lib/components/Dashboard.svelte";
	import ConnectionManager from "$lib/components/ConnectionManager.svelte";
	import SqlEditor from "$lib/components/SqlEditor.svelte";
	import StructureTable from "$lib/components/StructureTable.svelte";
	import SettingsModal from "$lib/components/SettingsModal.svelte";
	import ConnectionManagementModal from "$lib/components/ConnectionManagementModal.svelte";
	import OllamaChat from "$lib/components/OllamaChat.svelte";
	import NotificationList from "$lib/components/NotificationList.svelte";
	import GlobalOptionsMenu from "$lib/components/GlobalOptionsMenu.svelte";
	import CreateDatabaseModal from "$lib/components/CreateDatabaseModal.svelte";
	import { initSettings } from "$lib/state.svelte";
	import { Bot, Settings2, Plus, Settings, LogOut, RefreshCw } from "@lucide/svelte";
	import { onMount } from "svelte";

	function handleRefresh() {
		socket.emit("get_databases");
		if (appState.currentDatabase && appState.currentTable) {
			if (appState.activeTab === "data") {
				const offset = (appState.currentPage - 1) * appState.pageSize;
				socket.emit("get_table_data", {
					database: appState.currentDatabase,
					table: appState.currentTable,
					limit: appState.pageSize,
					offset,
					sortColumn: appState.currentSortColumn,
					sortDirection: appState.currentSortDirection,
					searchFilters: appState.currentSearchFilters.length
						? appState.currentSearchFilters
						: null,
					searchLogic: appState.currentSearchLogic,
				});
			} else if (appState.activeTab === "structure") {
				socket.emit("get_table_structure", {
					database: appState.currentDatabase,
					table: appState.currentTable
				});
			} else if (appState.activeTab === "indexes") {
				socket.emit("get_table_indexes", {
					database: appState.currentDatabase,
					table: appState.currentTable
				});
			}
		}
	}

	let isSettingsOpen = $state(false);
	let isCreateDbModalOpen = $state(false);
	let lastDb = $state(appState.currentDatabase);
	let lastTable = $state(appState.currentTable);

	$effect(() => {
		if (appState.currentDatabase !== lastDb || appState.currentTable !== lastTable) {
			appState.savedQuery = "";
			lastDb = appState.currentDatabase;
			lastTable = appState.currentTable;
		}
	});

	onMount(() => {
		initSettings();
	});
</script>

<SettingsModal bind:isOpen={isSettingsOpen} />
<ConnectionManagementModal />
<NotificationList />
<CreateDatabaseModal bind:isOpen={isCreateDbModalOpen} />

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
				<div class="flex items-center gap-2">
					<button
						class="text-muted-foreground hover:text-foreground hover:bg-secondary rounded p-1 transition-colors"
						title="Create new database"
						onclick={() => isCreateDbModalOpen = true}
					>
						<Plus class="w-4 h-4" />
					</button>
					<span>Databases</span>
				</div>
				<button
					class="text-xs bg-secondary text-secondary-foreground px-2 py-1 rounded hover:opacity-80 flex items-center gap-1"
					onclick={handleRefresh}
					>
					<RefreshCw class="w-3 h-3" />
					Refresh
				</button>
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
				class="h-14 border-b bg-card flex justify-between gap-4 items-center px-4 shrink-0 shadow-sm"
			>
				<div class="flex items-center gap-2 justify-start shrink-0">
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

				<div class="flex-1 flex justify-center items-center min-w-0">
					{#if appState.currentDatabase || appState.isConnected}
						<GlobalOptionsMenu />
					{/if}
				</div>

				<div class="flex items-center justify-end gap-2 text-sm font-medium shrink-0">
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
						onclick={() => (appState.isConnectionManagerOpen = true)}
						title="Manage Connections"
					>
						<Settings2 class="w-4 h-4" />
					</button>
					<div class="relative group">
						<button
							class="flex items-center justify-center bg-secondary text-secondary-foreground w-8 h-8 rounded-md ml-2 hover:bg-secondary/80 transition-colors"
							onclick={() => (isSettingsOpen = true)}
						>
							<Settings class="w-4 h-4" />
						</button>
						<div class="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-popover text-popover-foreground text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
							Settings
						</div>
					</div>

					<div class="relative group">
						<button
							class="flex items-center justify-center bg-secondary text-secondary-foreground w-8 h-8 rounded-md ml-2 hover:bg-destructive hover:text-destructive-foreground transition-colors"
							onclick={() => {
								appState.isConnected = false;
								appState.currentDatabase = null;
								appState.currentTable = null;
								socket.emit("disconnect_db");
							}}
						>
							<LogOut class="w-4 h-4" />
						</button>
						<div class="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-popover text-popover-foreground text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
							Logout
						</div>
					</div>
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
