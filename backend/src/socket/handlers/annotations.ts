import type { Socket } from 'socket.io';
import { AnnotationService } from '../../services/AnnotationService';

export function registerAnnotationHandlers(
  socket: Socket,
  annotationService: AnnotationService,
): void {
  socket.on('get_annotations', async () => {
    try {
      socket.emit('annotations', await annotationService.getAll());
    } catch { /* non-fatal */ }
  });

  socket.on(
    'save_annotation',
    async ({ key, note }: { key: string; note: string }) => {
      try {
        const data = await annotationService.save(key, note);
        socket.emit('annotations', data);
      } catch {
        socket.emit('error', { message: 'Failed to save annotation' });
      }
    },
  );

  socket.on('delete_annotation', async ({ key }: { key: string }) => {
    try {
      const data = await annotationService.delete(key);
      socket.emit('annotations', data);
    } catch { /* non-fatal */ }
  });
}
