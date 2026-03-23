import express from "express";
import { LobbyMonitor } from "./LobbyMonitor";
import { GameMonitor } from "./GameMonitor";

import { BrowserManager } from "./BrowserManager";

const app = express();
const PORT = process.env.PORT || 8085;

// Global auth headers extracted from Puppeteer
const browserManager = new BrowserManager();
const lobbyMonitor = new LobbyMonitor(browserManager);
const activeGameMonitors = new Map<string, GameMonitor>();

async function startPlatform() {
  await browserManager.initialize();

  // Start listening for lobby updates through the headless browser
  await lobbyMonitor.start();
  
  app.listen(PORT, () => {
    console.log(`FrontMonitor Oracle running on port ${PORT}`);
  });
}

startPlatform();

app.get("/api/markets/upcoming", (req, res) => {
  const games = lobbyMonitor.getActiveGames();
  res.json({ upcomingGames: games });
});

app.post("/api/markets/:gameID/track", async (req, res) => {
  const gameID = req.params.gameID;
  if (activeGameMonitors.has(gameID)) {
    return res.status(400).json({ error: "Game already tracked" });
  }

  const monitor = new GameMonitor(gameID, 20, browserManager);
  monitor.start();
  activeGameMonitors.set(gameID, monitor);

  
  try {
    await monitor.start();
    res.json({ message: "Started tracking game", gameID });
  } catch (err) {
    if (err instanceof Error) {
      res.status(500).json({ error: err.message });
    } else {
      res.status(500).json({ error: "Unknown error" });
    }
  }
});

app.get("/api/markets/:gameID/state", (req, res) => {
  const gameID = req.params.gameID;
  const monitor = activeGameMonitors.get(gameID);

  if (!monitor) {
    return res.status(404).json({ error: "Game not tracked" });
  }

  const state = monitor.getGameState();
  if (!state) {
    return res.status(503).json({ error: "Game state not initialized yet" });
  }

  res.json(state);
});
