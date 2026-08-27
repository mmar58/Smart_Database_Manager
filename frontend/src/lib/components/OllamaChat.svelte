<script lang="ts">
    import { appState, saveOllamaState } from '$lib/state.svelte';
    import { socket } from '$lib/services/socket';
    import { MessageSquare, Maximize2, Minimize2, X, Send, Bot, ArrowRightLeft, SquareTerminal, PanelRightClose, PanelRightOpen, Plus, Trash2, StopCircle, Zap } from '@lucide/svelte';
    import { encode } from 'gpt-tokenizer';
    import FloatingQuery from './FloatingQuery.svelte';

    // UI state
    let isMinimized = $state(false);
    let showSessionList = $state(false);
    let x = $state(window.innerWidth - 420);
    let y = $state(100);

    // Floating Query state
    let isFloatingQueryOpen = $state(false);
    let floatingQueryString = $state("");

    // Model & API state
    let models: string[] = $state([]);
    let modelContextLength = $state(2048);
    let selectedModel = $state(appState.settings?.ollamaModel || '');
    let currentInput = $state('');
    let isLoading = $state(false);
    let currentAbortController: AbortController | null = null;
    let chatContainer: HTMLElement | null = $state(null);

    // Computed tokens
    let totalTokensUsed = $derived.by(() => {
        if (!currentSession) return 0;
        const fullText = currentSession.messages.map(m => m.content).join(' ');
        return encode(fullText).length;
    });

    // Draggable logic for floating mode
    let isDragging = false;
    let startX: number, startY: number, initialX: number, initialY: number;

    function startDrag(e: MouseEvent) {
        if (appState.ollama.layout !== 'floating') return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        initialX = x;
        initialY = y;
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', stopDrag);
    }

    function onDrag(e: MouseEvent) {
        if (!isDragging) return;
        x = initialX + (e.clientX - startX);
        y = initialY + (e.clientY - startY);
    }

    function stopDrag() {
        isDragging = false;
        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('mouseup', stopDrag);
    }

    // Sessions Logic
    let currentSession = $derived(
        appState.ollama.sessions.find(s => s.id === appState.ollama.currentSessionId)
    );

    function createNewSession() {
        const newSession = {
            id: Date.now().toString(),
            title: 'New Conversation',
            messages: [],
            updatedAt: Date.now()
        };
        appState.ollama.sessions = [newSession, ...appState.ollama.sessions];
        appState.ollama.currentSessionId = newSession.id;
        saveOllamaState();
    }

    function deleteSession(id: string) {
        appState.ollama.sessions = appState.ollama.sessions.filter(s => s.id !== id);
        if (appState.ollama.currentSessionId === id) {
            appState.ollama.currentSessionId = appState.ollama.sessions.length > 0 ? appState.ollama.sessions[0].id : null;
        }
        saveOllamaState();
    }

    function clearChat() {
        if (currentSession) {
            currentSession.messages = [];
            currentSession.updatedAt = Date.now();
            saveOllamaState();
        }
    }

    function toggleLayout() {
        appState.ollama.layout = appState.ollama.layout === 'floating' ? 'sidebar' : 'floating';
        saveOllamaState();
    }

    // Model Logic
    async function fetchModels() {
        const url = appState.settings?.ollamaApiUrl || 'http://localhost:11434';
        try {
            const res = await fetch(`${url}/api/tags`);
            if (res.ok) {
                const data = await res.json();
                models = data.models.map((m: any) => m.name);
                if (!selectedModel && models.length > 0) {
                    selectedModel = models[0];
                    appState.settings.ollamaModel = selectedModel;
                }
                if (selectedModel) fetchModelInfo(selectedModel);
            }
        } catch (e) {
            console.error("Failed to fetch Ollama models", e);
        }
    }

    async function fetchModelInfo(modelName: string) {
        const url = appState.settings?.ollamaApiUrl || 'http://localhost:11434';
        try {
            const res = await fetch(`${url}/api/show`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: modelName })
            });
            if (res.ok) {
                const data = await res.json();
                // Context length usually in details parameter num_ctx or default to 2048
                const ctxInfo = data.details?.parameter?.num_ctx;
                if (ctxInfo) modelContextLength = parseInt(ctxInfo);
                else modelContextLength = 4096; // safe default for most models
            }
        } catch (e) {
            console.error(e);
        }
    }

    $effect(() => {
        if (appState.ollama.isOpen && models.length === 0) {
            fetchModels();
            if (appState.ollama.sessions.length === 0) createNewSession();
        }
    });

    $effect(() => {
        if ((currentSession?.messages.length ?? 0) > 0 && chatContainer) {
            setTimeout(() => {
                if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
            }, 50);
        }
    });

    // DB Query Execution
    async function executeQueryPromise(db: string, query: string): Promise<any> {
        return new Promise((resolve, reject) => {
            const onResult = (data: any) => { cleanup(); resolve(data); };
            const onError = (data: any) => { cleanup(); reject(data.message || "Unknown error"); };
            const cleanup = () => {
                socket.off("query_result", onResult);
                socket.off("query_execution_error", onError);
            };
            socket.on("query_result", onResult);
            socket.on("query_execution_error", onError);
            socket.emit("execute_query", { database: db, query });
        });
    }

    function extractRows(res: any): any[] {
        const payload = res.result;
        if (!payload) return Array.isArray(res) ? res : [];
        if (payload.type === 'SELECT') {
            return payload.multipleStatements 
                ? (payload.data[payload.data.length - 1]?.data || []) 
                : (payload.data || []);
        } else if (payload.type === 'MODIFY') {
            return [{ Message: payload.message, AffectedRows: payload.affectedRows, InsertID: payload.insertId }];
        }
        return [];
    }

    function stopGenerating() {
        if (currentAbortController) {
            currentAbortController.abort();
            currentAbortController = null;
            isLoading = false;
        }
    }

    async function summarizeChat() {
        if (!currentSession || currentSession.messages.length === 0 || isLoading) return;
        
        const url = appState.settings?.ollamaApiUrl || 'http://localhost:11434';
        const model = selectedModel;
        
        isLoading = true;
        
        try {
            currentAbortController = new AbortController();
            const response = await fetch(`${url}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: currentAbortController.signal,
                body: JSON.stringify({
                    model: model,
                    messages: [
                        { role: 'system', content: 'Summarize the following conversation state, capturing the user goal, current database state, and key decisions. Do not answer questions, just output a concise summary.' },
                        ...currentSession.messages.map(m => ({ role: m.role, content: m.content }))
                    ],
                    stream: false
                })
            });
            if (response.ok) {
                const data = await response.json();
                currentSession.messages = [
                    { role: 'system', content: 'Conversation Summarized:' },
                    { role: 'assistant', content: data.message.content }
                ];
                saveOllamaState();
            }
        } catch (e: any) {
            if (e.name !== 'AbortError') console.error(e);
        } finally {
            isLoading = false;
            currentAbortController = null;
        }
    }

    async function sendMessage() {
        if (!currentInput.trim() || isLoading || !currentSession) return;
        
        currentSession.messages.push({ role: 'user', content: currentInput });
        currentSession.updatedAt = Date.now();
        // Set title if it's the first message
        if (currentSession.messages.length <= 2) {
            currentSession.title = currentInput.substring(0, 30) + (currentInput.length > 30 ? '...' : '');
        }
        
        currentInput = '';
        isLoading = true;
        saveOllamaState();

        const url = appState.settings?.ollamaApiUrl || 'http://localhost:11434';
        const model = selectedModel;

        const tools = [
            {
                type: "function",
                function: {
                    name: "run_query",
                    description: "Execute a SQL query against the current database. You can SELECT, INSERT, UPDATE, ALTER, CREATE etc.",
                    parameters: {
                        type: "object",
                        properties: { query: { type: "string", description: "The SQL query to execute" } },
                        required: ["query"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "get_schema",
                    description: "Get the schema structure of a specific table.",
                    parameters: {
                        type: "object",
                        properties: { table_name: { type: "string", description: "Name of the table" } },
                        required: ["table_name"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "write_to_editor",
                    description: "Write a SQL query into the user's query editor for them to review or run.",
                    parameters: {
                        type: "object",
                        properties: { query: { type: "string", description: "The SQL query to write" } },
                        required: ["query"]
                    }
                }
            }
        ];

        let messagesForOllama = [
            {
                role: 'system',
                content: `You are a database expert assistant. The user is currently connected to MySQL. 
Current database: ${appState.currentDatabase || 'None'}.
Current table: ${appState.currentTable || 'None'}.
You can use tools to run queries, get schema, or write to the editor. If you are unsure of table names, run SHOW TABLES. Use get_schema to learn column names before writing complex queries. Always write correct MySQL syntax.`
            },
            ...currentSession.messages.map(m => ({ role: m.role, content: m.content }))
        ];

        let toolCallActive = true;
        
        currentAbortController = new AbortController();

        try {
            while (toolCallActive && currentAbortController) {
                const response = await fetch(`${url}/api/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: currentAbortController.signal,
                    body: JSON.stringify({
                        model: model,
                        messages: messagesForOllama,
                        stream: false,
                        tools: tools
                    })
                });

                if (!response.ok) throw new Error("API Error");

                const data = await response.json();
                const responseMessage = data.message;
                messagesForOllama.push(responseMessage);

                if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
                    for (const tool of responseMessage.tool_calls) {
                        const functionName = tool.function.name;
                        const args = tool.function.arguments;
                        let toolResult = "";

                        currentSession.messages.push({ role: 'assistant', content: `🛠️ Using tool: ${functionName}`, action: JSON.stringify(args) });
                        saveOllamaState();

                        if (functionName === 'write_to_editor') {
                            floatingQueryString = args.query;
                            if (appState.activeTab === 'query') {
                                // wait, we don't have direct access to sqlEditor query bindable here globally
                                // let's always open floating query or switch tab
                                isFloatingQueryOpen = true;
                                toolResult = "Query sent to editor overlay.";
                            } else {
                                isFloatingQueryOpen = true;
                                toolResult = "Query sent to floating query window.";
                            }
                        } else if (functionName === 'run_query') {
                            if (!appState.currentDatabase) {
                                toolResult = "Error: No database selected.";
                            } else {
                                const q = args.query.toUpperCase();
                                if (q.includes('DROP ') || q.includes('DELETE ') || q.includes('TRUNCATE ')) {
                                    if (confirm(`Ollama wants to run a destructive query:\n\n${args.query}\n\nAllow this execution?`)) {
                                        try {
                                            const res: any = await executeQueryPromise(appState.currentDatabase, args.query);
                                            toolResult = JSON.stringify(extractRows(res)).substring(0, 1000);
                                        } catch(e) { toolResult = `Error executing query: ${e}`; }
                                    } else {
                                        toolResult = "User denied the execution of this query.";
                                    }
                                } else {
                                    try {
                                        const res: any = await executeQueryPromise(appState.currentDatabase, args.query);
                                        toolResult = JSON.stringify(extractRows(res)).substring(0, 1000);
                                    } catch(e) { toolResult = `Error executing query: ${e}`; }
                                }
                            }
                        } else if (functionName === 'get_schema') {
                            if (!appState.currentDatabase) {
                                toolResult = "Error: No database selected.";
                            } else {
                                try {
                                    const res: any = await executeQueryPromise(appState.currentDatabase, `DESCRIBE \`${args.table_name}\``);
                                    toolResult = JSON.stringify(extractRows(res));
                                } catch(e) { toolResult = `Error: ${e}`; }
                            }
                        }

                        messagesForOllama.push({ role: 'tool', content: toolResult });
                    }
                } else {
                    toolCallActive = false;
                    currentSession.messages.push({ role: 'assistant', content: responseMessage.content });
                    saveOllamaState();
                }
            }
        } catch (e: any) {
            if (e.name !== 'AbortError') {
                console.error(e);
                currentSession.messages.push({ role: 'assistant', content: `Error communicating with Ollama: ${e}` });
                saveOllamaState();
            }
        } finally {
            isLoading = false;
            currentAbortController = null;
        }
    }
</script>

{#if appState.ollama.isOpen}
    <div 
        class="{appState.ollama.layout === 'floating' 
            ? 'fixed z-50 bg-background border rounded-lg shadow-2xl flex flex-col overflow-hidden resize' 
            : 'absolute top-0 right-0 h-full w-[400px] border-l bg-background shadow-xl flex flex-col z-40'}"
        style={appState.ollama.layout === 'floating' ? `width: 420px; height: 600px; top: ${y}px; left: ${x}px; min-width: 300px; min-height: 400px;` : ''}
    >
        <!-- Header -->
        <div 
            class="h-12 border-b bg-muted/50 flex items-center justify-between px-3 shrink-0 {appState.ollama.layout === 'floating' ? 'cursor-move' : ''}"
            onmousedown={startDrag}
            role="dialog"
            tabindex="0"
        >
            <div class="flex items-center gap-2 font-semibold">
                <Bot class="w-5 h-5 text-primary" />
                <span>Assistant</span>
            </div>
            
            <div class="flex items-center gap-1">
                <button class="p-1.5 hover:bg-muted rounded text-muted-foreground transition-colors" onclick={() => showSessionList = !showSessionList} title="History">
                    <MessageSquare class="w-4 h-4" />
                </button>
                <button class="p-1.5 hover:bg-muted rounded text-muted-foreground transition-colors" onclick={toggleLayout} title={appState.ollama.layout === 'floating' ? 'Dock to sidebar' : 'Pop out window'}>
                    {#if appState.ollama.layout === 'floating'}
                        <PanelRightClose class="w-4 h-4" />
                    {:else}
                        <PanelRightOpen class="w-4 h-4" />
                    {/if}
                </button>
                <button class="p-1.5 hover:bg-muted rounded text-muted-foreground transition-colors" onclick={() => { if(appState.ollama.layout === 'floating') isMinimized = !isMinimized; }}>
                    {#if isMinimized}
                        <Maximize2 class="w-4 h-4" />
                    {:else}
                        <Minimize2 class="w-4 h-4" />
                    {/if}
                </button>
                <button class="p-1.5 hover:bg-destructive/10 hover:text-destructive rounded text-muted-foreground transition-colors" onclick={() => appState.ollama.isOpen = false}>
                    <X class="w-4 h-4" />
                </button>
            </div>
        </div>

        {#if !isMinimized}
            <div class="flex-1 flex overflow-hidden">
                <!-- Session List Sidebar -->
                {#if showSessionList}
                    <div class="w-48 border-r bg-muted/30 flex flex-col">
                        <div class="p-2">
                            <button class="w-full flex items-center gap-2 px-3 py-2 bg-primary/10 text-primary rounded-md text-sm hover:bg-primary/20" onclick={createNewSession}>
                                <Plus class="w-4 h-4" /> New Chat
                            </button>
                        </div>
                        <div class="flex-1 overflow-y-auto px-2 pb-2">
                            {#each appState.ollama.sessions as session}
                                <div class="group flex items-center justify-between p-2 rounded text-sm mb-1 cursor-pointer {session.id === appState.ollama.currentSessionId ? 'bg-muted' : 'hover:bg-muted/50'}" onclick={() => appState.ollama.currentSessionId = session.id}>
                                    <span class="truncate max-w-[120px]">{session.title}</span>
                                    <button class="opacity-0 group-hover:opacity-100 p-1 hover:text-destructive" onclick={(e) => { e.stopPropagation(); deleteSession(session.id); }}>
                                        <Trash2 class="w-3 h-3" />
                                    </button>
                                </div>
                            {/each}
                        </div>
                    </div>
                {/if}

                <!-- Main Chat Area -->
                <div class="flex-1 flex flex-col relative">
                    <!-- Context Usage Bar -->
                    <div class="px-3 py-1 bg-muted/30 border-b flex items-center justify-between text-xs text-muted-foreground">
                        <div class="flex items-center gap-2">
                            <span>Tokens: {totalTokensUsed} / {modelContextLength}</span>
                            <div class="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div class="h-full bg-primary" style="width: {Math.min((totalTokensUsed / modelContextLength) * 100, 100)}%;"></div>
                            </div>
                        </div>
                        <button class="flex items-center gap-1 hover:text-primary" onclick={summarizeChat} disabled={isLoading}>
                            <Zap class="w-3 h-3" /> Summarize
                        </button>
                    </div>

                    <div class="flex-1 overflow-y-auto p-4 space-y-4" bind:this={chatContainer}>
                        {#if currentSession?.messages.length === 0}
                            <div class="h-full flex flex-col items-center justify-center text-muted-foreground opacity-50 space-y-2">
                                <Bot class="w-12 h-12" />
                                <p>How can I help with your database?</p>
                            </div>
                        {/if}
                        
                        {#each currentSession?.messages || [] as msg}
                            <div class="flex {msg.role === 'user' ? 'justify-end' : 'justify-start'}">
                                <div class="max-w-[85%] rounded-xl px-4 py-2 {msg.role === 'user' ? 'bg-primary text-primary-foreground' : (msg.role === 'tool' ? 'bg-muted/50 text-xs text-muted-foreground font-mono' : 'bg-muted')}">
                                    {#if msg.role === 'assistant'}
                                        <div class="prose prose-sm dark:prose-invert max-w-none">
                                            {@html msg.content.replace(/\n/g, '<br>')}
                                        </div>
                                    {:else if msg.role === 'user' || msg.role === 'system'}
                                        <div class="whitespace-pre-wrap">{msg.content}</div>
                                    {/if}
                                    
                                    {#if msg.action}
                                        <div class="mt-2 text-xs opacity-75 font-mono p-2 bg-background/50 rounded">
                                            {msg.action}
                                        </div>
                                    {/if}
                                </div>
                            </div>
                        {/each}
                    </div>

                    <!-- Input Area -->
                    <div class="p-3 border-t bg-background shrink-0">
                        {#if isLoading}
                            <div class="flex justify-center mb-2">
                                <button class="flex items-center gap-2 px-3 py-1 bg-destructive/10 text-destructive rounded-full text-xs hover:bg-destructive/20" onclick={stopGenerating}>
                                    <StopCircle class="w-3 h-3" /> Stop Generating
                                </button>
                            </div>
                        {/if}
                        <div class="flex items-center gap-2">
                            <select 
                                bind:value={selectedModel}
                                onchange={(e) => { appState.settings.ollamaModel = e.currentTarget.value; fetchModelInfo(e.currentTarget.value); }}
                                class="text-xs bg-muted border-none rounded px-2 py-1 max-w-[100px]"
                            >
                                {#each models as m}
                                    <option value={m}>{m}</option>
                                {/each}
                            </select>
                            
                            <form class="flex items-center gap-2 flex-1" onsubmit={(e) => { e.preventDefault(); sendMessage(); }}>
                                <input 
                                    type="text" 
                                    bind:value={currentInput}
                                    placeholder={isLoading ? "Generating..." : "Ask anything..."}
                                    disabled={isLoading}
                                    class="flex-1 bg-transparent border-none text-sm focus:ring-0 placeholder:text-muted-foreground outline-none"
                                />
                                {#if (currentSession?.messages.length ?? 0) > 0}
                                    <button type="button" class="p-2 hover:bg-muted rounded-full text-muted-foreground hover:text-destructive transition-colors" onclick={clearChat} title="Clear Chat">
                                        <Trash2 class="w-4 h-4" />
                                    </button>
                                {/if}
                                <button type="submit" disabled={!currentInput.trim() || isLoading} class="p-2 bg-primary text-primary-foreground rounded-full hover:opacity-90 disabled:opacity-50 transition-colors">
                                    <Send class="w-4 h-4" />
                                </button>
                            </form>
                        </div>
                    </div>
                </div>
            </div>
        {/if}
    </div>
{/if}

<FloatingQuery bind:isOpen={isFloatingQueryOpen} bind:query={floatingQueryString} />
