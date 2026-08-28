import type { Socket } from 'socket.io';
import { QueryHistoryService } from '../../services/QueryHistoryService';
import type { QueryHistoryEntry } from '../../types';

export function registerHistoryHandlers(
  socket: Socket,
  historyService: QueryHistoryService,
): void {
  socket.on('get_query_history', async () => {
    try {
      socket.emit('query_history', await historyService.getAll());
    } catch { /* non-fatal */ }
  });

  socket.on(
    'save_query_history',
    async (queryObj: Omit<QueryHistoryEntry, 'timestamp'>) => {
      try {
        const history = await historyService.add(queryObj);
        socket.emit('query_history', history);
      } catch { /* non-fatal */ }
    },
  );

  socket.on('clear_query_history', async () => {
    try {
      await historyService.clear();
      socket.emit('query_history', []);
    } catch { /* non-fatal */ }
  });
}
