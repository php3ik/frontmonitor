import { randomUUID } from "node:crypto";
import { createGameRunner, GameRunner } from "./OpenFrontIO/src/core/GameRunner";
import { ServerMessage, ClientJoinMessage } from "./OpenFrontIO/src/core/Schemas";
import { NodeGameMapLoader } from "./NodeGameMapLoader";
import { simpleHash } from "./OpenFrontIO/src/core/Util";
import { BrowserManager } from "./BrowserManager";

export class GameMonitor {
  private ws: any = null;
  private gameRunner: GameRunner | null = null;
  public isRunning = false;
  private turnsSeen = 0;

  constructor(
    public readonly gameID: string,
    private readonly workerCount: number = 20,
    private browserManager: BrowserManager
  ) {}

  public async start() {
    this.isRunning = true;
    const workerIndex = simpleHash(this.gameID) % this.workerCount;
    const wsUrl = `wss://openfront.io/w${workerIndex}`;
    
    console.log(`GameMonitor connecting to ${wsUrl} for game ${this.gameID} via browser`);
    this.ws = await this.browserManager.createWebSocket(wsUrl, true);

    this.ws.on("open", async () => {
      console.log(`GameMonitor connected! Sending join intent...`);
      const token = await this.browserManager.getPlayToken();
      const joinMsg: ClientJoinMessage = {
        type: "join",
        token: token,
        gameID: this.gameID,
        username: "OracleBot",
        clanTag: null,
        turnstileToken: null,
      };
      this.ws?.send(JSON.stringify(joinMsg));
    });

    this.ws.on("message", async (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as ServerMessage;
        await this.handleServerMessage(msg);
      } catch (err) {
        console.error("Error handling server message:", err);
      }
    });

    this.ws.on("close", () => {
      console.log(`GameMonitor connection closed for game ${this.gameID}`);
      this.isRunning = false;
    });

    this.ws.on("error", (err: any) => {
      console.error(`GameMonitor error for game ${this.gameID}:`, err);
    });
  }

  private async handleServerMessage(msg: ServerMessage) {
    if (msg.type === "start") {
      console.log(`Game started! Initializing GameRunner...`);
      const mapLoader = new NodeGameMapLoader(this.browserManager);
      
      this.gameRunner = await createGameRunner(
        msg.gameStartInfo,
        msg.myClientID,
        mapLoader,
        (gu) => {
          if ("errMsg" in gu) {
            console.error("GameRunner Error Update:", gu.errMsg);
          }
        }
      );
      
      console.log(`GameRunner initialized.`);

      // Apply initial turns
      for (const turn of msg.turns) {
        if (turn.turnNumber < this.turnsSeen) continue;
        this.gameRunner.addTurn(turn);
        this.turnsSeen++;
      }
      this.processPendingTurns();
    } else if (msg.type === "turn") {
      if (!this.gameRunner) return;
      if (this.turnsSeen !== msg.turn.turnNumber) {
        console.warn(`Turn desync: Expected ${this.turnsSeen}, got ${msg.turn.turnNumber}`);
      } else {
        this.gameRunner.addTurn(msg.turn);
        this.turnsSeen++;
        this.processPendingTurns();
      }
    } else if (msg.type === "error") {
      console.error(`Server error:`, msg.message);
    } else if (msg.type === "desync") {
      console.warn(`Server notified desync.`);
    }
  }

  private processPendingTurns() {
    if (!this.gameRunner) return;
    
    // Pump the game engine to execute all pending turns
    while (this.gameRunner.pendingTurns() > 0) {
      const success = this.gameRunner.executeNextTick();
      if (!success) {
        console.error("executeNextTick failed!");
        break;
      }
    }
  }

  public getGameState() {
    if (!this.gameRunner) return null;

    const game = this.gameRunner.game;
    const players = game.players().map((p) => {
      return {
        id: p.id(),
        username: p.name(),
        isAlive: p.isAlive(),
        troops: Number(p.troops()), // Troops can be big numbers, ensure JS num 
        tilesOwned: p.numTilesOwned(),
        gold: Number(p.gold()),
        // Add more analytics as needed
      };
    });

    return {
      gameID: this.gameID,
      ticks: game.ticks(),
      spawnPhase: game.inSpawnPhase(),
      players: players.sort((a, b) => b.tilesOwned - a.tilesOwned), // sorted leaderboards
    };
  }

  public stop() {
    this.isRunning = false;
    this.ws?.close();
  }
}
