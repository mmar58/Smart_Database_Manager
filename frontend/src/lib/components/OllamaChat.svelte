<script lang="ts">
    import { appState } from '$lib/state.svelte';
    import { socket } from '$lib/services/socket';
    import { MessageSquare, Maximize2, Minimize2, X, Send, Bot, Columns, ArrowRightLeft, SquareTerminal } from '@lucide/svelte';

    let { isOpen = $bindable(false), queryEditorValue = $bindable("") } = $props<{ isOpen: boolean, queryEditorValue: string }>();

    let isFloating = $state(false);
    let isMinimized = $state(false);
    
    // Position for floating UI
    let x = $state(window.innerWidth - 420);
    let y = $state(100);

    let models: string[] = $state([]);
    let selectedModel = $state(appState.settings?.ollamaModel || '');
    let chatHistory = $state<{role: string, content: string, action?: string}[]>([]);
    let currentInput = $state('');
    let isLoading = $state(false);
    let chatContainer: HTMLElement | null = $state(null);

    // Draggable logic
    let isDragging = false;
    let startX: number, startY: number, initialX: number, initialY: number;

    function startDrag(e: MouseEvent) {
        if (!isFloating) return;
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
            }
        } catch (e) {
            console.error("Failed to fetch Ollama models", e);
        }
    }

    $effect(() => {
        if (isOpen && models.length === 0) {
            fetchModels();
        }
    });

    $effect(() => {
        if (chatHistory.length > 0 && chatContainer) {
            setTimeout(() => {
                if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
            }, 50);
        }
    });

    async function executeQueryPromise(db: string, query: string): Promise<any> {
        return new Promise((resolve, reject) => {
            const onResult = (data: any) => {
                cleanup();
                resolve(data);
            };
            const onError = (err: string) => {
                cleanup();
                reject(err);
            };
            
            const cleanup = () => {
                socket.off("query_result", onResult);
                socket.off("query_error", onError);
            };

            socket.on("query_result", onResult);
            socket.on("query_error", onError);
            
            socket.emit("execute_query", db, query);
        });
    }

    async function sendMessage() {
        if (!currentInput.trim() || isLoading) return;
        
        chatHistory = [...chatHistory, { role: 'user', content: currentInput }];
        const userInput = currentInput;
        currentInput = '';
        isLoading = true;

        const url = appState.settings?.ollamaApiUrl || 'http://localhost:11434';
        const model = selectedModel;

        const tools = [
            {
                type: "function",
                function: {
                    name: "run_query",
                    description: "Execute a SQL query against the current database.",
                    parameters: {
                        type: "object",
                        properties: {
                            query: { type: "string", description: "The SQL query to execute" }
                        },
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
                        properties: {
                            table_name: { type: "string", description: "The name of the table" }
                        },
                        required: ["table_name"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "write_to_editor",
                    description: "Write SQL code to the user's SQL query editor without executing it.",
                    parameters: {
                        type: "object",
                        properties: {
                            query: { type: "string", description: "The SQL query to put in the editor" }
                        },
                        required: ["query"]
                    }
                }
            }
        ];

        try {
            // Keep looping to handle tool calls
            let messagesForOllama = [
                { role: 'system', content: `You are an AI assistant for a MySQL database management tool. The current selected database is '${appState.currentDatabase || 'None'}'. Help the user explore their database using tools.` },
                ...chatHistory.map(m => ({ role: m.role, content: m.content || "" }))
            ];

            let toolCallActive = true;
            
            while(toolCallActive) {
                const res = await fetch(`${url}/api/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: model,
                        messages: messagesForOllama,
                        tools: tools,
                        stream: false
                    })
                });

                if (!res.ok) throw new Error("API Error");
                const data = await res.json();
                const responseMessage = data.message;
                
                if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
                    messagesForOllama.push(responseMessage);
                    
                    for (const tool of responseMessage.tool_calls) {
                        const functionName = tool.function.name;
                        const args = tool.function.arguments;
                        let toolResult = "";

                        chatHistory = [...chatHistory, { role: 'assistant', content: `🛠️ Using tool: ${functionName}`, action: JSON.stringify(args) }];

                        if (functionName === 'write_to_editor') {
                            queryEditorValue = args.query;
                            toolResult = "Query successfully written to editor.";
                        } else if (functionName === 'run_query') {
                            if (!appState.currentDatabase) {
                                toolResult = "Error: No database selected.";
                            } else {
                                const q = args.query.toUpperCase();
                                if (q.includes('DROP ') || q.includes('DELETE ') || q.includes('TRUNCATE ')) {
                                    if (confirm(`Ollama wants to run a destructive query:\n\n${args.query}\n\nAllow this execution?`)) {
                                        try {
                                            const res = await executeQueryPromise(appState.currentDatabase, args.query);
                                            toolResult = JSON.stringify(res.rows || res).substring(0, 1000); // truncate for context
                                        } catch(e) {
                                            toolResult = `Error executing query: ${e}`;
                                        }
                                    } else {
                                        toolResult = "User denied the execution of this query.";
                                    }
                                } else {
                                    try {
                                        const res = await executeQueryPromise(appState.currentDatabase, args.query);
                                        toolResult = JSON.stringify(res.rows || res).substring(0, 1000);
                                    } catch(e) {
                                        toolResult = `Error executing query: ${e}`;
                                    }
                                }
                            }
                        } else if (functionName === 'get_schema') {
                            if (!appState.currentDatabase) {
                                toolResult = "Error: No database selected.";
                            } else {
                                try {
                                    const res: any = await executeQueryPromise(appState.currentDatabase, `DESCRIBE \`${args.table_name}\``);
                                    toolResult = JSON.stringify(res.rows || res);
                                } catch(e) {
                                    toolResult = `Error: ${e}`;
                                }
                            }
                        }

                        messagesForOllama.push({
                            role: 'tool',
                            content: toolResult
                        });
                    }
                } else {
                    toolCallActive = false;
                    chatHistory = [...chatHistory, { role: 'assistant', content: responseMessage.content }];
                }
            }
        } catch (e) {
            console.error(e);
            chatHistory = [...chatHistory, { role: 'assistant', content: `Error communicating with Ollama: ${e}` }];
        } finally {
            isLoading = false;
        }
    }
</script>

{#if isOpen}
    <div 
        class="{isFloating ? 'fixed shadow-xl z-50 border rounded-lg overflow-hidden flex flex-col' : 'w-[400px] border-l flex flex-col shrink-0'} bg-card transition-all"
        style="{isFloating ? `left: ${x}px; top: ${y}px; width: 400px; height: ${isMinimized ? '48px' : '550px'};` : 'height: 100%;'}"
    >
        <!-- Header -->
        <div 
            class="h-12 border-b bg-muted/50 flex items-center justify-between px-3 shrink-0 {isFloating ? 'cursor-move' : ''}"
            onmousedown={startDrag}
        >
            <div class="flex items-center gap-2 font-medium text-sm">
                <Bot class="w-4 h-4 text-primary" />
                Ollama DB Assistant
            </div>
            <div class="flex items-center gap-1">
                <button onclick={() => isFloating = !isFloating} class="p-1.5 text-muted-foreground hover:bg-secondary rounded-md" title={isFloating ? "Dock to side" : "Pop out"}>
                    <ArrowRightLeft class="w-3.5 h-3.5" />
                </button>
                {#if isFloating}
                    <button onclick={() => isMinimized = !isMinimized} class="p-1.5 text-muted-foreground hover:bg-secondary rounded-md">
                        {#if isMinimized}
                            <Maximize2 class="w-3.5 h-3.5" />
                        {:else}
                            <Minimize2 class="w-3.5 h-3.5" />
                        {/if}
                    </button>
                {/if}
                <button onclick={() => isOpen = false} class="p-1.5 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground rounded-md">
                    <X class="w-3.5 h-3.5" />
                </button>
            </div>
        </div>

        {#if !isMinimized}
            <!-- Model Selection -->
            <div class="p-2 border-b bg-background">
                <select bind:value={selectedModel} class="w-full h-8 text-xs rounded-md border border-input bg-transparent px-2">
                    {#if models.length === 0}
                        <option value="">No models found...</option>
                    {:else}
                        {#each models as model}
                            <option value={model}>{model}</option>
                        {/each}
                    {/if}
                </select>
            </div>

            <!-- Chat History -->
            <div bind:this={chatContainer} class="flex-1 overflow-y-auto p-4 space-y-4 text-sm bg-muted/10">
                {#if chatHistory.length === 0}
                    <div class="text-center text-muted-foreground h-full flex flex-col items-center justify-center opacity-50">
                        <Bot class="w-12 h-12 mb-2" />
                        <p>Ask me about your database!</p>
                        <p class="text-xs mt-1">I can write queries and inspect schemas.</p>
                    </div>
                {/if}
                {#each chatHistory as msg}
                    <div class="flex flex-col {msg.role === 'user' ? 'items-end' : 'items-start'}">
                        <div class="max-w-[85%] rounded-lg px-3 py-2 {msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}">
                            {#if msg.action}
                                <div class="text-xs font-mono bg-background/50 text-foreground p-1.5 rounded mb-1 border border-border/50">
                                    {msg.content}<br/>
                                    {msg.action}
                                </div>
                            {:else}
                                <div class="whitespace-pre-wrap">{msg.content}</div>
                            {/if}
                        </div>
                    </div>
                {/each}
                {#if isLoading}
                    <div class="flex items-start">
                        <div class="bg-secondary text-secondary-foreground rounded-lg px-4 py-2">
                            <div class="flex gap-1 items-center h-4">
                                <span class="w-1.5 h-1.5 bg-current rounded-full animate-bounce"></span>
                                <span class="w-1.5 h-1.5 bg-current rounded-full animate-bounce" style="animation-delay: 0.1s"></span>
                                <span class="w-1.5 h-1.5 bg-current rounded-full animate-bounce" style="animation-delay: 0.2s"></span>
                            </div>
                        </div>
                    </div>
                {/if}
            </div>

            <!-- Input -->
            <div class="p-3 border-t bg-background flex gap-2 items-end">
                <textarea 
                    bind:value={currentInput}
                    onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                    placeholder="Ask Ollama..."
                    class="flex-1 max-h-32 min-h-[40px] resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    rows="1"
                ></textarea>
                <button 
                    onclick={sendMessage}
                    disabled={isLoading || !currentInput.trim()}
                    class="h-10 w-10 shrink-0 inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                    <Send class="w-4 h-4" />
                </button>
            </div>
        {/if}
    </div>
{/if}
