import { execSync } from 'node:child_process';
import type { CareerTariffsViewProps } from './CareerTariffsView';

const cache = new Map<string, string>();

export function renderTariffsStaticHtml(props: CareerTariffsViewProps): string {
  const key = JSON.stringify(props);
  const cached = cache.get(key);
  if (cached) return cached;

  const result = execSync('npx tsx src/features/tariffs/renderTariffsCli.ts', {
    input: key,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });

  cache.set(key, result);
  return result;
}
