import { existsSync, statSync, statfsSync } from 'node:fs';

export interface DiskCapacitySnapshot {
  readonly dbSizeMb: number;
  readonly walSizeMb: number;
  readonly diskFreeMb: number;
  readonly diskFreePct: number;
  readonly diskLow: boolean;
}

export interface DiskCapacityThresholds {
  readonly minFreeMb?: number;
  readonly minFreePct?: number;
}

const DEFAULT_MIN_FREE_MB = 15_000;
const DEFAULT_MIN_FREE_PCT = 15;
const BYTES_PER_MB = 1024 * 1024;

function fileSizeMb(filePath: string): number {
  if (!existsSync(filePath)) return 0;
  try {
    return Math.round(statSync(filePath).size / BYTES_PER_MB);
  } catch {
    return 0;
  }
}

/**
 * Reads SQLite file + WAL sizes and underlying filesystem headroom for maintenance telemetry.
 * Returns undefined for `:memory:` or paths whose filesystem cannot be queried.
 */
export function readDiskCapacity(
  databasePath: string | undefined,
  thresholds?: DiskCapacityThresholds,
): DiskCapacitySnapshot | undefined {
  if (!databasePath || databasePath === ':memory:') return undefined;
  try {
    const fsStats = statfsSync(databasePath);
    const totalBytes = Number(fsStats.blocks) * Number(fsStats.bsize);
    const freeBytes = Number(fsStats.bavail) * Number(fsStats.bsize);
    const diskFreeMb = Math.round(freeBytes / BYTES_PER_MB);
    const diskFreePct =
      totalBytes > 0 ? Math.round((freeBytes / totalBytes) * 1000) / 10 : 0;
    const minFreeMb = thresholds?.minFreeMb ?? DEFAULT_MIN_FREE_MB;
    const minFreePct = thresholds?.minFreePct ?? DEFAULT_MIN_FREE_PCT;
    return {
      dbSizeMb: fileSizeMb(databasePath),
      walSizeMb: fileSizeMb(`${databasePath}-wal`),
      diskFreeMb,
      diskFreePct,
      diskLow: diskFreeMb < minFreeMb || diskFreePct < minFreePct,
    };
  } catch {
    return undefined;
  }
}

export interface DiskTelemetryLog {
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
}

/**
 * Updates low-disk alert state and returns fields to include in `maintenance-memory`.
 */
export function collectDiskTelemetry(
  databasePath: string | undefined,
  log: DiskTelemetryLog,
  wasLow: boolean,
): { readonly fields: Record<string, number>; readonly diskLow: boolean } {
  const disk = readDiskCapacity(databasePath);
  if (!disk) return { fields: {}, diskLow: wasLow };
  const fields = {
    dbSizeMb: disk.dbSizeMb,
    walSizeMb: disk.walSizeMb,
    diskFreeMb: disk.diskFreeMb,
    diskFreePct: disk.diskFreePct,
  };
  if (disk.diskLow && !wasLow) {
    log.warn(fields, 'maintenance-disk-low');
  } else if (!disk.diskLow && wasLow) {
    log.info({ diskFreeMb: disk.diskFreeMb, diskFreePct: disk.diskFreePct }, 'maintenance-disk-ok');
  }
  return { fields, diskLow: disk.diskLow };
}
