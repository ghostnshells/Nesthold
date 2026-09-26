import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import type { Game } from './game';

/** Pushes live events (pigeons landing, raids, being attacked) to connected players. */
export function attachHub(server: Server, game: Game) {
  const sockets = new Map<string, Set<WebSocket>>();
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const token = new URL(req.url ?? '', 'http://x').searchParams.get('token') ?? '';
    const player = token ? game.playerByToken(token) : null;
    if (!player) {
      ws.close(4001, 'unauthorized');
      return;
    }
    const set = sockets.get(player.id) ?? new Set();
    set.add(ws);
    sockets.set(player.id, set);
    ws.send(JSON.stringify({ type: 'hello', serverTime: game.now() }));
    ws.on('close', () => {
      set.delete(ws);
      if (!set.size) sockets.delete(player.id);
    });
  });

  game.push = (playerId, message) => {
    const payload = JSON.stringify(message);
    for (const ws of sockets.get(playerId) ?? []) if (ws.readyState === ws.OPEN) ws.send(payload);
  };
  return wss;
}
