# Nesthold 🦆

An isometric iOS base-builder: **Clash of Clans meets Clusterduck**. Build and defend your nest, hatch specialised ducks, raid rival nests alone or with your flock, and message flock-mates by carrier pigeon. Rival hawks can snatch those pigeons out of the sky.

- **Single-player:** place and upgrade buildings on a 36×36 isometric grid, collect grain and feathers, and hatch economy ducks (Farmer, Construction and Molting Ducks) and raiding ducks (Mallard, Eider, Teal, Merganser, Sapper, Medic).
- **Duck-themed defenses:** Air-Defense Catapult, Birdshot Blaster, Heron Watchtower and Snapping Turtle Pit.
- **Distractions:** the Feed Scatterer and the Fake Mating-Call Horn divert a handful of ducks for a few seconds. The simulation enforces hard caps of 5 ducks and 4 seconds, and a distracted duck is briefly immune afterwards.
- **Multiplayer:** asynchronous raids on other players' nest snapshots, validated server-side by replaying the deterministic battle. Flocks can donate ducks and run co-op **flock raids** with pooled armies and split loot.
- **Carrier pigeons:** flock-mates can only talk by pigeon. Pigeons fly real routes across the world map. Any rival Hawk Perch whose radius covers the route gets a seeded chance to intercept and read the message. You can counter with escorts, armour, or an enciphered Pigeon Loft.

See [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) for the full design and numbers.

## Layout

```
packages/shared   Pure TypeScript game core: data tables, economy rules, A* pathfinding,
                  deterministic battle sim, pigeon interception, bot nest generator
packages/server   Express + WebSocket server on Node's built-in SQLite (node:sqlite)
packages/client   Phaser 3 + Vite client with procedurally drawn isometric art,
                  wrapped for iOS with Capacitor (packages/client/ios)
e2e/smoke.mjs     Playwright smoke test at an iPhone viewport
```

The client and the server run the **same** battle simulation. The client plays it live, then sends only the list of deploy commands. The server replays those commands against the same snapshot and seed, and awards the loot it computed itself.

## Running it

Requires Node 22+.

```bash
npm install
npm run build        # build the web client
npm start            # server on http://localhost:8787, serving the built client
```

Open http://localhost:8787 in a browser. Mobile device emulation works best. You're signed in as a guest with a starter nest. The server seeds bot nests and a bot flock, **Puddle Patrol**, so you can try raids, flock raids and pigeons on your own.

For development with hot reload, run these in two terminals:

```bash
npm run dev:server   # :8787
npm run dev:client   # Vite on :5173, proxies /api and /ws to the server
```

Environment variables:
- `PORT` sets the server port (default 8787).
- `NESTHOLD_DB` sets the SQLite file path (default `packages/server/nesthold.db`).
- `VITE_API_URL` is the server URL baked into the client build. It's required for the iOS app, e.g. `https://nest.example.com` or `http://192.168.1.20:8787` on your LAN.

## iOS

The Xcode project is in `packages/client/ios` (Capacitor 8, Swift Package Manager, no CocoaPods). On a Mac with Xcode:

```bash
cd packages/client
VITE_API_URL=http://<your-mac-ip>:8787 npm run build
npx cap sync ios
npx cap open ios     # then pick a simulator or device and press Run
```

The app is portrait-only and fullscreen, with the status bar hidden. `NSAllowsLocalNetworking` is enabled so a development build can reach a server on your LAN. For production, host the server behind HTTPS/WSS.

## Tests

```bash
npm test             # vitest: shared game rules + server API flows
npm run typecheck
npm run e2e          # needs a running server with the built client (npm run build && npm start)
```

Coverage includes:
- **Battle sim**: determinism, live stepping matching the server replay, distraction caps and immunity, disciplined ducks ignoring the horn, wall pathing, sappers, and air/ground targeting.
- **Pigeons**: route geometry and interception odds.
- **Server**: tampered loot claims, shields, donations, raid pledging, refunds and loot splits, and pigeons delivered, intercepted, and replied to by bots.
