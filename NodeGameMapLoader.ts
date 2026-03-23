import { GameMapType } from "./OpenFrontIO/src/core/game/Game";
import { GameMapLoader, MapData } from "./OpenFrontIO/src/core/game/GameMapLoader";
import { MapManifest } from "./OpenFrontIO/src/core/game/TerrainMapLoader";
import { BrowserManager } from "./BrowserManager";

export class NodeGameMapLoader implements GameMapLoader {
  private maps: Map<GameMapType, MapData>;
  private baseUrl = "https://openfront.io";

  constructor(private browserManager: BrowserManager) {
    this.maps = new Map<GameMapType, MapData>();
  }

  private createLazyLoader<T>(importFn: () => Promise<T>): () => Promise<T> {
    let cache: Promise<T> | null = null;
    return () => {
      cache ??= importFn();
      return cache;
    };
  }

  getMapData(map: GameMapType): MapData {
    const cachedMap = this.maps.get(map);
    if (cachedMap) {
      return cachedMap;
    }

    const key = Object.keys(GameMapType).find(
      (k) => GameMapType[k as keyof typeof GameMapType] === map,
    );
    const fileName = key?.toLowerCase();

    const loadBinary = async (url: string) => {
      console.log(`Fetching map data from ${url} via Puppeteer`);
      return await this.browserManager.fetchBinary(url);
    };

    const mapBasePath = `${this.baseUrl}/maps/${fileName}`;

    const mapData = {
      mapBin: this.createLazyLoader(() => loadBinary(`${mapBasePath}/map.bin`)),
      map4xBin: this.createLazyLoader(() =>
        loadBinary(`${mapBasePath}/map4x.bin`),
      ),
      map16xBin: this.createLazyLoader(() =>
        loadBinary(`${mapBasePath}/map16x.bin`),
      ),
      manifest: this.createLazyLoader(() =>
        this.browserManager.fetchJson(`${mapBasePath}/manifest.json`)
      ),
      webpPath: `${mapBasePath}/thumbnail.webp`,
    } satisfies MapData;

    this.maps.set(map, mapData);
    return mapData;
  }
}
