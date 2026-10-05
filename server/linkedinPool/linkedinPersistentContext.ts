import { execFile } from 'node:child_process';
import type { BrowserContext, BrowserType } from 'playwright';
import {
  getLinkedinChromiumLaunchArgs,
  getLinkedinStealthContextOptions,
  installLinkedinStealthScript,
} from './linkedinStealthBrowser';

export interface PersistentContextOptions {
  readonly timezone?: string;
  /** Подменяется в тестах; по умолчанию версия берётся у самого бинарника Chromium. */
  readonly readVersion?: (executablePath: string) => Promise<string | undefined>;
}

/** "Chromium 141.0.7390.37" -> "141.0.7390.37". */
export function parseChromiumVersionOutput(output: string): string | undefined {
  return /(\d{2,3}\.\d+\.\d+\.\d+)/u.exec(output)?.[1];
}

export function readChromiumVersion(executablePath: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(executablePath, ['--version'], { timeout: 5_000 }, (error, stdout) => {
      resolve(error ? undefined : parseChromiumVersionOutput(String(stdout)));
    });
  });
}

/**
 * Постоянный профиль аккаунта: cookie, localStorage и отпечаток живут между
 * запусками, как в обычном браузере. UA строится из настоящей версии Chromium.
 */
export async function launchLinkedinPersistentContext(
  chromium: Pick<BrowserType, 'launchPersistentContext' | 'executablePath'>,
  profileDirectory: string,
  options: PersistentContextOptions = {},
): Promise<BrowserContext> {
  const readVersion = options.readVersion ?? readChromiumVersion;
  const browserVersion = await readVersion(chromium.executablePath());
  const context = await chromium.launchPersistentContext(profileDirectory, {
    headless: true,
    args: getLinkedinChromiumLaunchArgs(),
    ...getLinkedinStealthContextOptions({
      ...(options.timezone ? { timezone: options.timezone } : {}),
      ...(browserVersion ? { browserVersion } : {}),
    }),
  });
  await installLinkedinStealthScript(context);
  return context;
}
