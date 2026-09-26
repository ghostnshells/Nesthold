import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { runScheduler, seedBots } from './bots';
import { openDb } from './db';
import { Game } from './game';
import { attachHub } from './hub';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 8787);
const dbPath = process.env.NESTHOLD_DB ?? resolve(here, '../nesthold.db');
const staticDir = resolve(here, '../../client/dist');

const db = openDb(dbPath);
const game = new Game(db);
seedBots(db, game.now());

const app = createApp(game, { staticDir: existsSync(staticDir) ? staticDir : undefined });
const server = createServer(app);
attachHub(server, game);
setInterval(() => {
  try {
    runScheduler(game);
  } catch (err) {
    console.error('scheduler', err);
  }
}, 1000);

server.listen(port, () => console.log(`Nesthold server on http://localhost:${port} (db: ${dbPath})`));
