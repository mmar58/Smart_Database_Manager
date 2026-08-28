import { io, Socket } from 'socket.io-client';
import { appState, notifyStateChanged } from '$lib/state.svelte';

import { browser } from '$app/environment';

// Socket instance
export let socket: Socket;

if (browser) {
    socket = io();

    // Auto-reconnect credentials
    socket.io.on('reconnect', () => {
        if (appState.currentCredentials) {
            socket.emit('set_credentials', appState.currentCredentials);
        }
    });

    // System stats listener
    socket.on('stats_update', (data: any) => {
        document.dispatchEvent(new CustomEvent('stats_update', { detail: data }));
    });

    // Backup listeners
    socket.on('backup_progress', (msg: string) => {
        document.dispatchEvent(new CustomEvent('backup_progress', { detail: msg }));
    });
    socket.on('backup_complete', (msg: string) => {
        document.dispatchEvent(new CustomEvent('backup_complete', { detail: msg }));
    });
    socket.on('backup_error', (msg: string) => {
        document.dispatchEvent(new CustomEvent('backup_error', { detail: msg }));
    });

    // Slow Queries listeners
    socket.on('slow_queries_data', (queries: any[]) => {
        document.dispatchEvent(new CustomEvent('slow_queries_data', { detail: queries }));
    });

    // Settings listener
    socket.on('settings_data', (settings: any) => {
        appState.settings = settings;
        notifyStateChanged();
        document.dispatchEvent(new CustomEvent('settings_loaded', { detail: settings }));
    });
}
