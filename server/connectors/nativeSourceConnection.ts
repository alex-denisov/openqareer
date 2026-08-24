import type { StoredNativeSourceConnection } from '../data/candidateStore';
import type { CandidateConnectionView } from './oauthConnector';
import { OAUTH_PLATFORMS } from './oauthTypes';

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

export function mergeCandidateConnectionViews(
  oauth: CandidateConnectionView[],
  native: StoredNativeSourceConnection[],
): Array<CandidateConnectionView | NativeSourceConnectionView> {
  const nativeByPlatform = new Map(
    native.map((connection) => [connection.platform, nativeSourceConnectionView(connection)]),
  );
  const oauthByPlatform = new Map(oauth.map((connection) => [connection.platform, connection]));
  return OAUTH_PLATFORMS.map(
    (platform) => nativeByPlatform.get(platform) ?? oauthByPlatform.get(platform)!,
  );
}
