import type { BrowserContext, Page } from 'playwright';
import {
  buildObscuraLaunchArgs,
  buildObscuraStealthScript,
  getRandomizedUserAgent,
  getRandomizedViewport,
  type ObscuraLaunchOptions,
} from './obscuraStealth';

export interface ObscuraRunnerConfig extends ObscuraLaunchOptions {
  readonly userDataDir: string;
}

export class ObscuraRunner {
  private context: BrowserContext | null = null;

  constructor(private readonly config: ObscuraRunnerConfig) {}

  public async getContext(): Promise<BrowserContext> {
    if (this.context) {
      return this.context;
    }

    const { chromium } = await import('playwright');
    const args = buildObscuraLaunchArgs(this.config);
    const viewport = getRandomizedViewport();
    const userAgent = getRandomizedUserAgent();

    this.context = await chromium.launchPersistentContext(this.config.userDataDir, {
      headless: this.config.headless ?? true,
      args,
      viewport,
      userAgent,
      bypassCSP: true,
      ignoreHTTPSErrors: true,
    });

    const stealthScript = buildObscuraStealthScript();
    await this.context.addInitScript(stealthScript);

    return this.context;
  }

  public async openPage(url: string): Promise<Page> {
    const ctx = await this.getContext();
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    return page;
  }

  public async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
  }
}
