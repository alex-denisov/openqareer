import { execSync } from 'node:child_process';
import type { AppUpdateStatusData } from './appUpdateTypes';

const cache = new Map<string, string>();

export function renderAppUpdateStaticHtml(status: AppUpdateStatusData): string {
  const key = JSON.stringify(status);
  const cached = cache.get(key);
  if (cached) return cached;

  const result = execSync('npx tsx src/features/appUpdate/renderAppUpdateCli.ts', {
    input: key,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });

  cache.set(key, result);
  return result;
}
