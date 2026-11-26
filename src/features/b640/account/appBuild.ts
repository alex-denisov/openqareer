import { isBuildMarked } from '../../shell/buildFreshness';

const DATE = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' });

/** «Версия 1.1.0 · сборка a1b2c3d · 19 ноября 2026»: по строке видно, какая сборка стоит. */
export function appBuildLine(version: string, commitSha: string, builtAt: string): string {
  const sha = commitSha.trim();
  const parts = [`Версия ${version}`];
  if (isBuildMarked(sha)) parts.push(`сборка ${sha.slice(0, 7)}`);
  const time = Date.parse(builtAt);
  if (Number.isFinite(time)) parts.push(DATE.format(time).replace(/\s*г\.$/u, ''));
  return parts.join(' · ');
}
