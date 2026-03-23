import puppeteer from 'puppeteer-extra';
// @ts-ignore
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, Page } from 'puppeteer';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

puppeteer.use(StealthPlugin());

export class BrowserManager {
  private browser: Browser | null = null;
  private page: Page | null = null;

  public async initialize() {
    console.log("BrowserManager: Launching headless browser...");
    this.browser = await puppeteer.launch({
      headless: false, // Running non-headless is the most reliable way to bypass Cloudflare locally
      defaultViewport: null, // Avoid default 800x600 viewport
      ignoreDefaultArgs: ["--enable-automation"], // Remove automation infobar and flags
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1280,720' // Set a realistic window size matching viewport
      ]
    });

    this.page = await this.browser.newPage();
    this.page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    this.page.on('pageerror', (err: any) => console.log('PAGE ERROR:', err.toString()));
    
    console.log("BrowserManager: Navigating to https://openfront.io to solve Cloudflare challenge...");
    
    await this.page.goto("https://openfront.io", {
      waitUntil: "domcontentloaded",
      timeout: 60000 
    });

    console.log("BrowserManager: Waiting for Cloudflare challenge to be solved...");
    await this.page.waitForSelector('#app', { timeout: 60000 });
    
    // Slight delay to ensure SPA is fully initialized
    await new Promise(r => setTimeout(r, 4000));
    console.log("BrowserManager: Cloudflare bypassed seamlessly, DOM ready.");
  }

  public async createWebSocket(url: string, expectsBinary: boolean = false) {
    if (!this.page) throw new Error("BrowserManager not initialized");
    
    const wsId = randomUUID().replace(/-/g, "");
    const emitter = new EventEmitter();

    await this.page.exposeFunction(`onOpen_${wsId}`, () => emitter.emit("open"));
    await this.page.exposeFunction(`onClose_${wsId}`, () => emitter.emit("close"));
    await this.page.exposeFunction(`onError_${wsId}`, (err: any) => emitter.emit("error", err));
    await this.page.exposeFunction(`onMessage_${wsId}`, (data: string, isBin: boolean) => {
        if (isBin) {
            emitter.emit("message", Buffer.from(data, 'base64'));
        } else {
            emitter.emit("message", Buffer.from(data));
        }
    });

    await this.page.evaluate((url, id, isBin) => {
        console.log(`Starting inner WebSocket connection for ${url}`);
        const ws = new WebSocket(url);
        (window as any)[`ws_${id}`] = ws;
        if (isBin) ws.binaryType = 'arraybuffer';
        
        ws.onopen = () => (window as any)[`onOpen_${id}`]();
        ws.onclose = () => (window as any)[`onClose_${id}`]();
        ws.onerror = (e) => (window as any)[`onError_${id}`]((e as any).message || "Unknown error");
        ws.onmessage = async (e) => {
            if (e.data instanceof ArrayBuffer) {
                let binary = '';
                const bytes = new Uint8Array(e.data);
                for (let i = 0; i < bytes.byteLength; i++) {
                    binary += String.fromCharCode(bytes[i]);
                }
                (window as any)[`onMessage_${id}`](window.btoa(binary), true);
            } else {
                (window as any)[`onMessage_${id}`](e.data, false);
            }
        };
    }, url, wsId, expectsBinary);

    return {
        on: (event: string, cb: any) => emitter.on(event, cb),
        send: async (data: string) => {
            await this.page!.evaluate(async (id, msg) => {
                const ws = (window as any)[`ws_${id}`];
                if (ws) {
                    while (ws.readyState === 0) await new Promise(r => setTimeout(r, 10)); // Defeats connecting race condition
                    ws.send(msg); // Will reliably fire when readyState=1
                }
            }, wsId, data);
        },
        close: async () => {
            await this.page!.evaluate((id) => {
                (window as any)[`ws_${id}`].close();
            }, wsId);
        }
    };
  }

  public async getPlayToken(): Promise<string> {
    if (!this.page) throw new Error("BrowserManager not initialized");
    return await this.page.evaluate(async () => {
      try {
        const response = await fetch("https://api.openfront.io/auth/refresh", {
          method: "POST",
          credentials: "include"
        });
        if (response.ok) {
            const json = await response.json();
            return json.jwt;
        }
      } catch (e) {
          console.error("Token fetch error", e);
      }
      return crypto.randomUUID();
    });
  }

  public async fetchBinary(url: string): Promise<Uint8Array> {
    if (!this.page) throw new Error("BrowserManager not initialized");
    const base64 = await this.page.evaluate(async (u) => {
      const res = await fetch(u);
      if (!res.ok) throw new Error("Failed");
      const buf = await res.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
      }
      return window.btoa(binary);
    }, url);
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }

  public async fetchJson(url: string): Promise<any> {
    if (!this.page) throw new Error("BrowserManager not initialized");
    return await this.page.evaluate(async (u) => {
      const res = await fetch(u);
      if (!res.ok) throw new Error("Failed");
      return await res.json();
    }, url);
  }

  public async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }
}
