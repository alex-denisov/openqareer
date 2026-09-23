import type { StoredNativeSourceConnection } from '../data/candidateStore';

export const SUPPORTED_PLATFORMS = ['linkedin', 'hh'] as const;
export type SupportedPlatform = (typeof SUPPORTED_PLATFORMS)[number];

export interface NativeSourceConnectionView {
  platform: StoredNativeSourceConnection['platform'];
  available: true;
  status: 'connected';
  accessMode: 'native_session_snapshot';
  capabilities: ['resume_read'];
  importsCareerHistory: true;
  connectedAt: string;
  lastImportedAt: string;
  factCount: number;
}

export interface DisconnectedConnectionView {
  platform: SupportedPlatform;
  available: boolean;
  status: 'disconnected';
  capabilities: ['resume_read'];
  importsCareerHistory: true;
}

/**
 * A document from this platform was imported (file upload or the desktop
 * companion's file path), but there is no live session snapshot — the
 * candidate has not "connected" the platform, only handed over one snapshot
 * of it. Reading this as bare `disconnected` contradicted the dossier the
 * candidate could see right next to it (B247 S7).
 */
export interface ImportedConnectionView {
  platform: SupportedPlatform;
  available: boolean;
  status: 'imported';
  capabilities: ['resume_read'];
  importsCareerHistory: true;
  importedAt: string;
}

export type CandidateConnectionView =
  | NativeSourceConnectionView
  | ImportedConnectionView
  | DisconnectedConnectionView;

export interface ImportedFactSource {
  platform: SupportedPlatform;
  importedAt: string;
}

const IMPORT_LABEL_PLATFORM: ReadonlyArray<[prefix: string, platform: SupportedPlatform]> = [
  ['Импорт: профиль LinkedIn', 'linkedin'],
  ['Импорт: резюме hh.ru', 'hh'],
];

function platformForImportLabel(content: string): SupportedPlatform | undefined {
  return IMPORT_LABEL_PLATFORM.find(([prefix]) => content.startsWith(prefix))?.[1];
}

/**
 * A resume import writes one conversation message carrying the origin label
 * (`resumeImportLabel`) and one or more dossier facts pointing back at that
 * message id. Cross-referencing the two is the only record of "this platform
 * was imported" once the import is not tied to a live session connection.
 */
export function deriveImportedFactSources(
  messages: ReadonlyArray<{ id: string; content: string }>,
  memory: ReadonlyArray<{ sourceMessageIds: readonly string[]; createdAt: string }>,
): ImportedFactSource[] {
  const importedAtByMessageId = new Map<string, string>();
  for (const entry of memory) {
    for (const messageId of entry.sourceMessageIds) {
      const existing = importedAtByMessageId.get(messageId);
      if (!existing || entry.createdAt > existing) {
        importedAtByMessageId.set(messageId, entry.createdAt);
      }
    }
  }

  const importedAtByPlatform = new Map<SupportedPlatform, string>();
  for (const message of messages) {
    const platform = platformForImportLabel(message.content);
    if (!platform) continue;
    const importedAt = importedAtByMessageId.get(message.id);
    if (!importedAt) continue;
    const existing = importedAtByPlatform.get(platform);
    if (!existing || importedAt > existing) {
      importedAtByPlatform.set(platform, importedAt);
    }
  }

  return Array.from(importedAtByPlatform.entries()).map(([platform, importedAt]) => ({
    platform,
    importedAt,
  }));
}

export function nativeSourceConnectionView(
  stored: StoredNativeSourceConnection,
): NativeSourceConnectionView {
  return {
    platform: stored.platform,
    available: true,
    status: 'connected',
    accessMode: stored.accessMode,
    capabilities: ['resume_read'],
    importsCareerHistory: true,
    connectedAt: stored.connectedAt,
    lastImportedAt: stored.lastImportedAt,
    factCount: stored.receipt.factCount,
  };
}

export function listCandidateConnectionViews(
  native: StoredNativeSourceConnection[],
  importedFacts: ReadonlyArray<ImportedFactSource> = [],
): CandidateConnectionView[] {
  const nativeByPlatform = new Map(
    native.map((connection) => [connection.platform, nativeSourceConnectionView(connection)]),
  );
  const importedByPlatform = new Map(
    importedFacts.map((source) => [source.platform, source]),
  );
  return SUPPORTED_PLATFORMS.map((platform) => {
    const connected = nativeByPlatform.get(platform);
    if (connected) return connected;
    const imported = importedByPlatform.get(platform);
    if (imported) {
      return {
        platform,
        available: true,
        status: 'imported',
        capabilities: ['resume_read'],
        importsCareerHistory: true,
        importedAt: imported.importedAt,
      };
    }
    return {
      platform,
      available: true,
      status: 'disconnected',
      capabilities: ['resume_read'],
      importsCareerHistory: true,
    };
  });
}
