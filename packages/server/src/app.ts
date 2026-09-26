import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { GameError } from '@nesthold/shared';
import type { PlayerRow } from './db';
import { Game, NotFound } from './game';

declare module 'express-serve-static-core' {
  interface Request {
    player?: PlayerRow;
  }
}

type Handler = (req: Request & { player: PlayerRow }) => unknown;

export function createApp(game: Game, opts: { staticDir?: string } = {}) {
  const app = express();
  app.use(express.json({ limit: '200kb' }));
  app.use((req, res, next) => {
    // The iOS app loads from capacitor://localhost, so allow cross-origin API calls.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return void res.sendStatus(204);
    next();
  });

  const auth = (req: Request, res: Response, next: NextFunction) => {
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const player = token ? game.playerByToken(token) : null;
    if (!player || player.isBot) return void res.status(401).json({ error: 'Not signed in' });
    req.player = player;
    next();
  };

  const route = (fn: Handler) => (req: Request, res: Response) => {
    try {
      const out = fn(req as Request & { player: PlayerRow });
      res.json(out === undefined ? { ok: true } : out);
    } catch (err) {
      if (err instanceof GameError) res.status(400).json({ error: err.message });
      else if (err instanceof NotFound) res.status(404).json({ error: err.message });
      else {
        console.error(err);
        res.status(500).json({ error: 'Something went wrong in the nest' });
      }
    }
  };

  const api = express.Router();
  api.get('/health', (_req, res) => void res.json({ ok: true, time: game.now() }));
  api.post(
    '/auth/guest',
    route((req) => {
      const { token, player } = game.createGuest(req.body?.name);
      return { token, ...game.me(player.id) };
    }),
  );

  api.use(auth);
  const me = (req: Request) => (req as Request & { player: PlayerRow }).player.id;
  const body = (req: Request) => (req.body ?? {}) as Record<string, any>;

  api.get('/me', route((req) => game.me(me(req))));
  api.post('/me/name', route((req) => game.rename(me(req), String(body(req).name ?? ''))));
  api.post('/nest/action', route((req) => game.nestAction(me(req), body(req) as any)));
  api.get('/world', route((req) => game.world(me(req))));

  api.post('/attack/start', route((req) => game.startAttack(me(req), String(body(req).targetId))));
  api.post('/attack/submit', route((req) => game.submitAttack(me(req), String(body(req).attackId), body(req).commands, body(req).claimed)));
  api.get('/battles', route((req) => game.battles(me(req))));
  api.get('/battles/:id', route((req) => game.replay(me(req), String(req.params.id))));

  api.get('/flocks', route(() => game.flocks()));
  api.get('/flock', route((req) => game.myFlock(me(req))));
  api.post('/flock/create', route((req) => game.createFlock(me(req), String(body(req).name ?? ''))));
  api.post('/flock/join', route((req) => game.joinFlock(me(req), String(body(req).flockId))));
  api.post('/flock/leave', route((req) => game.leaveFlock(me(req))));
  api.post('/flock/donate', route((req) => game.donate(me(req), String(body(req).to), String(body(req).kind), Number(body(req).count))));

  api.get('/raids', route((req) => game.raids(me(req))));
  api.post('/raid/open', route((req) => game.openRaid(me(req), String(body(req).targetId))));
  api.post('/raid/pledge', route((req) => game.pledge(me(req), String(body(req).raidId), body(req).army)));
  api.post('/raid/launch', route((req) => game.launchRaid(me(req), String(body(req).raidId))));

  api.post('/pigeon/preview', route((req) => game.pigeonPreview(me(req), String(body(req).to), body(req).kind ?? 'standard')));
  api.post('/pigeon/send', route((req) => game.sendPigeon(me(req), String(body(req).to), String(body(req).text ?? ''), body(req).kind ?? 'standard')));
  api.get('/pigeon/inbox', route((req) => game.inbox(me(req))));

  app.use('/api', api);
  if (opts.staticDir) app.use(express.static(opts.staticDir));
  return app;
}
