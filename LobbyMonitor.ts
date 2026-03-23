import { PublicGamesSchema, PublicGameInfo, PublicGameType } from "./OpenFrontIO/src/core/Schemas";
import { BrowserManager } from "./BrowserManager";

export class LobbyMonitor {
  private workers = 1; // Number of production workers
  private activeGames = new Map<string, PublicGameInfo>();

  constructor(private browserManager: BrowserManager) {}

  public async start() {
    await this.connectToWorkerLobbies(0); // Start from 0 to test
  }

  private async connectToWorkerLobbies(workerIndex: number) {
    const wsUrl = `wss://openfront.io/w${workerIndex}/lobbies`;
    const ws = await this.browserManager.createWebSocket(wsUrl, false);

    ws.on("open", () => {
      console.log(`LobbyMonitor connected to worker ${workerIndex}`);
    });

    ws.on("message", (data: any) => {
      try {
        const messageString = data.toString();
        const gamesUpdate = PublicGamesSchema.parse(JSON.parse(messageString));
        this.updateGamesCache(workerIndex, gamesUpdate);
        console.log(`Discovered ${this.activeGames.size} active games.`);
      } catch (err) {
        console.error(`LobbyMonitor parse error on worker ${workerIndex}:`, err);
      }
    });

    ws.on("close", () => {
      console.log(`LobbyMonitor disconnected from worker ${workerIndex}, reconnecting...`);
      setTimeout(() => this.connectToWorkerLobbies(workerIndex), 3000);
    });

    ws.on("error", (err: any) => {
      console.error(`LobbyMonitor WebSocket error on worker ${workerIndex}:`, err);
    });
  }

  private updateGamesCache(workerIndex: number, games: any) {
    for (const gameArray of Object.values(games.games)) {
      for (const game of gameArray as any[]) {
        this.activeGames.set(game.gameID, game);
      }
    }
  }

  public getActiveGames(): PublicGameInfo[] {
    return Array.from(this.activeGames.values());
  }
}
