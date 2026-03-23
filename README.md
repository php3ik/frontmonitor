# OpenFront.io Headless Oracle (FrontMonitor)

This service is a robust Node.js and Puppeteer-based Oracle used to stream live game states from the `openfront.io` multiplayer servers. It completely bypasses Cloudflare bot protection and natively integrates with the OpenFront engine to reproduce exact, deterministic game states.

Our objective is to serve real-time player leaderboards for downstream predictions markets like Limitless.exchange.

## Prerequisites

1. **Node.js**: It is highly recommended to use **Node v20** or higher.
    - If you are using Linux/Mac, you can install NVM (Node Version Manager) and run `nvm install 20`.
2. **NPM**: Automatically installed alongside Node.js.

## Installation & Setup

Because this repository uses the core OpenFrontIO engine as a Git Submodule, you MUST use `--recursive` when cloning it to fetch the engine files automatically:

```bash
git clone --recursive https://github.com/php3ik/frontmonitor.git
cd frontmonitor
npm install
```

If you accidentally cloned it without `--recursive`, you can initialize the submodule manually:
```bash
git submodule update --init --recursive
npm install
```

## Running the Oracle Locally

To start the FrontMonitor Oracle service:
```bash
npx tsx index.ts
```

### What Happens When You Run It:
1. The service launches a headless Google Chrome browser.
2. It navigates to `https://openfront.io` and waits inside the browser.
3. Once Cloudflare's Turnstile JS Challenge passes (usually taking 3-10 seconds), the Oracle exposes the underlying `page` object's WebSockets out to our Express server.
4. Your API server becomes fully active, securely connected to the multiplayer workers without throwing `HTTP 403 / 429` connection errors!

_Note: If you run this script in an ephemeral Sandbox/Docker environment or heavily flagged Datacenter IP, the Cloudflare Turnstile might continuously block the Chrome window. Running it locally on your desktop or a trusted residential network mitigates this completely._

## API Reference

The Oracle exposes its data via a local Express server on `http://localhost:8085`.

### 1. View Upcoming / Active Games
Polls the global worker lobbies to find newly spawning games dynamically.
* **Endpoint:** `GET /api/markets/upcoming`
* **Response:**
```json
{
  "upcomingGames": [
    {
      "gameID": "openfront123",
      "players": 12,
      ...
    }
  ]
}
```

### 2. Track & Simulate a Specific Game
Spawns an internal Game Engine (`GameRunner`) instance that joins the game as an anonymous spectator, compiling deterministic map events.
* **Endpoint:** `POST /api/markets/:gameID/track`
* **Response:**
```json
{
  "message": "Started tracking game",
  "gameID": "openfront123"
}
```

### 3. Fetch Live Leaderboard
Extracts the exact, up-to-the-tick leaderboard and player inventories straight from the live GameRunner memory. 
* **Endpoint:** `GET /api/markets/:gameID/state`
* **Response:**
```json
{
  "gameID": "openfront123",
  "ticks": 2045,
  "spawnPhase": false,
  "players": [
    {
      "id": 1,
      "username": "TraderJoe",
      "isAlive": true,
      "troops": 2504,
      "tilesOwned": 55,
      "gold": 12050
    }
  ]
}
```

## System Architecture
* `index.ts`: The Express Server Router endpoint mapping.
* `BrowserManager.ts`: The Puppeteer Stealth infrastructure. Converts Node endpoints into `page.evaluate()` CDP bridges.
* `GameMonitor.ts`: Connects to individual matched game grids, parsing binary frames natively.
* `LobbyMonitor.ts`: Hooks the OpenFront matchmaking arrays globally.
* `NodeGameMapLoader.ts`: Grabs `.bin` terrain grids dynamically over HTTP.
