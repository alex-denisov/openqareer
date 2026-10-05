import { pathToFileURL } from 'node:url';

/** На проде playwright-core лежит вне релиза (openqareer-browser-install): путь задаёт окружение. */
export function playwrightModuleSpecifier(): string {
  const path = process.env.OPENQAREER_PLAYWRIGHT_MODULE?.trim();
  return path ? pathToFileURL(path).href : 'playwright';
}
