import type { MaintenanceLog } from './maintenanceWorker';

const LEVELS = { info: 30, warn: 40, error: 50 } as const;

/**
 * Журнал обслуживателя в том же виде, что у HTTP-процесса (pino: `level`,
 * `time`, `msg`, поля контекста) — один `journalctl`-фильтр на оба юнита.
 * Без зависимости от Fastify: обслуживателю не нужен сервер.
 */
export function createJsonLineLog(
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
  base: Record<string, unknown> = { pid: process.pid, process: 'maintenance' },
): MaintenanceLog {
  const emit = (level: keyof typeof LEVELS) => (context: Record<string, unknown>, msg: string) => {
    write(JSON.stringify({ level: LEVELS[level], time: Date.now(), ...base, ...context, msg }));
  };
  return { info: emit('info'), warn: emit('warn'), error: emit('error') };
}
