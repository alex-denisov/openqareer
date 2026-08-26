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

export type CandidateConnectionView = NativeSourceConnectionView | DisconnectedConnectionView;

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
): CandidateConnectionView[] {
  const nativeByPlatform = new Map(
    native.map((connection) => [connection.platform, nativeSourceConnectionView(connection)]),
  );
  return SUPPORTED_PLATFORMS.map(
    (platform) =>
      nativeByPlatform.get(platform) ?? {
        platform,
        available: true,
        status: 'disconnected',
        capabilities: ['resume_read'],
        importsCareerHistory: true,
      },
  );
}
