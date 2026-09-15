import { execFile as nodeExecFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { ObscuraLaunchOptions } from './obscuraStealth';

const execFileAsync = promisify(nodeExecFile);

export type ObscuraDumpFormat = 'html' | 'text' | 'original' | 'cookies' | 'markdown';

export interface ObscuraCookie {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path: string;
  readonly secure: boolean;
  readonly httpOnly: boolean;
  readonly sameSite?: string;
  readonly expires?: number | null;
}

export interface ObscuraRunnerConfig extends ObscuraLaunchOptions {
  readonly binaryPath?: string;
  readonly userDataDir?: string;
}

export interface ObscuraFetchOptions {
  readonly userAgent?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly evalScript?: string;
}

export interface ObscuraRunnerDeps {
  readonly execFile?: (
    file: string,
    args: readonly string[],
    options: { signal?: AbortSignal; timeout?: number; maxBuffer?: number; encoding?: string },
  ) => Promise<{ stdout: string; stderr: string }>;
}

export interface ObscuraPage {
  content(): Promise<string>;
  url(): string;
  evaluate?<T>(fn: (...args: unknown[]) => T, args?: unknown): Promise<T>;
}

const DEFAULT_BIN_CANDIDATES = [
  'bin/obscura',
  '/opt/openqareer/bin/obscura',
  '/usr/local/bin/obscura',
] as const;

export function resolveObscuraBinPath(config: ObscuraRunnerConfig = {}): string {
  if (config.binaryPath) return config.binaryPath;
  const envPath = process.env.OBSCURA_BIN_PATH;
  if (envPath && existsSync(envPath)) return envPath;

  for (const candidate of DEFAULT_BIN_CANDIDATES) {
    const full = resolve(process.cwd(), candidate);
    if (existsSync(full)) return full;
  }
  return 'obscura';
}

export function buildObscuraCliArgs(
  url: string,
  dump: ObscuraDumpFormat,
  config: ObscuraRunnerConfig = {},
  options: ObscuraFetchOptions = {},
): string[] {
  const args = ['fetch', url, '--stealth', '--dump', dump];
  if (config.userDataDir) {
    args.push('--storage-dir', config.userDataDir);
  }
  if (config.proxyUrl) {
    args.push('--proxy', config.proxyUrl);
  }
  if (options.userAgent) {
    args.push('--user-agent', options.userAgent);
  }
  if (options.evalScript) {
    args.push('-e', options.evalScript);
  }
  return args;
}

export class ObscuraRunner {
  private readonly binPath: string;
  private readonly execFile: NonNullable<ObscuraRunnerDeps['execFile']>;

  constructor(
    private readonly config: ObscuraRunnerConfig = {},
    deps: ObscuraRunnerDeps = {},
  ) {
    this.binPath = resolveObscuraBinPath(config);
    this.execFile = deps.execFile ?? (execFileAsync as unknown as NonNullable<ObscuraRunnerDeps['execFile']>);
  }

  public async fetchHtml(url: string, options: ObscuraFetchOptions = {}): Promise<string> {
    const result = await this.execute(url, 'html', options);
    return result.stdout;
  }

  public async fetchCookies(url: string, options: ObscuraFetchOptions = {}): Promise<ObscuraCookie[]> {
    const result = await this.execute(url, 'cookies', options);
    try {
      const parsed = JSON.parse(result.stdout);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      throw new Error(`failed_to_parse_obscura_cookies: ${result.stdout.slice(0, 100)}`, {
        cause: err,
      });
    }
  }

  public async fetchOriginal(url: string, options: ObscuraFetchOptions = {}): Promise<string> {
    const result = await this.execute(url, 'original', options);
    return result.stdout;
  }

  public async openPage(url: string, options: ObscuraFetchOptions = {}): Promise<ObscuraPage> {
    let cachedContent: string | null = null;
    return {
      url: () => url,
      content: async () => {
        if (cachedContent === null) {
          cachedContent = await this.fetchHtml(url, options);
        }
        return cachedContent;
      },
    };
  }

  public async close(): Promise<void> {
    // Process-isolated invocations terminate immediately; nothing to tear down.
  }

  private execute(
    url: string,
    dump: ObscuraDumpFormat,
    options: ObscuraFetchOptions,
  ): Promise<{ stdout: string; stderr: string }> {
    const args = buildObscuraCliArgs(url, dump, this.config, options);
    return this.execFile(this.binPath, args, {
      signal: options.signal,
      timeout: options.timeoutMs ?? 30_000,
      maxBuffer: 20 * 1024 * 1024,
      encoding: 'utf-8',
    });
  }
}
