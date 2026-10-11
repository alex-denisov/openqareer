import type { StoredNativeSourceConnection } from '../candidateStore';

export function toExportedSourceConnection(connection: StoredNativeSourceConnection) {
  return {
    id: connection.id,
    platform: connection.platform,
    accessMode: connection.accessMode,
    connectedAt: connection.connectedAt,
    lastImportedAt: connection.lastImportedAt,
    capturedAt: connection.receipt.capturedAt,
    factCount: connection.receipt.factCount,
  };
}
