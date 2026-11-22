/**
 * B754: название устройства в «Аккаунт → Устройства» («MacBook · приложение openqareer»,
 * «iPhone · Safari»). Хранится только это название из фиксированного словаря, сам
 * user agent не сохраняется.
 */

const MAX_USER_AGENT = 1024;

const APP_ORIGINS = new Set([
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
]);

/** Порядок важен: iPad и iPhone раньше Mac, Android раньше Linux. */
const PLATFORMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\biPhone\b/u, 'iPhone'],
  [/\biPad\b/u, 'iPad'],
  [/\bAndroid\b/u, 'Android'],
  [/\bMacintosh\b|\bMac OS X\b/u, 'MacBook'],
  [/\bWindows NT\b/u, 'Windows'],
  [/\bCrOS\b/u, 'Chromebook'],
  [/\bLinux\b|\bX11\b/u, 'Linux'],
];

/** Порядок важен: браузеры на Chromium называют себя и Chrome, и Safari. */
const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bYaBrowser\//u, 'Яндекс Браузер'],
  [/\bEdg(?:e|A|iOS)?\//u, 'Edge'],
  [/\bOPR\/|\bOpera\b/u, 'Opera'],
  [/\bFirefox\/|\bFxiOS\//u, 'Firefox'],
  [/\bCriOS\/|\bChrome\//u, 'Chrome'],
  [/\bVersion\/\d[\d.]* .*\bSafari\//u, 'Safari'],
];

function firstMatch(text: string, table: ReadonlyArray<readonly [RegExp, string]>): string | null {
  return table.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

export function deviceLabelOf(
  userAgent: string | undefined,
  origin: string | undefined,
): string | null {
  if (!userAgent || userAgent.length > MAX_USER_AGENT) return null;
  const platform = firstMatch(userAgent, PLATFORMS);
  if (!platform) return null;
  if (origin && APP_ORIGINS.has(origin)) return `${platform} · приложение openqareer`;
  const browser = firstMatch(userAgent, BROWSERS);
  return browser ? `${platform} · ${browser}` : platform;
}
