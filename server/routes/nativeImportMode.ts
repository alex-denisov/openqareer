import type { CandidateStore, NativeSourceReceiptInput } from '../data/candidateStore';
import { nativeSourceConnectionView } from '../connectors/nativeSourceConnection';

export type NativeImportMode = 'profile' | 'connect_only' | 'replace_profile';
type NativePlatform = 'hh' | 'linkedin';

/**
 * One import source per profile (owner, 23.10.2026). A platform whose facts do
 * not build the profile only connects, unless the candidate asked to replace
 * the profile with it; refreshing the profile's own platform still imports.
 */
export function resolveNativeImportMode(
  candidateStore: CandidateStore,
  candidateId: string,
  platform: NativePlatform,
  requested: NativeImportMode = 'profile',
): NativeImportMode {
  if (requested !== 'profile') return requested;
  const profileFromOtherPlatform = candidateStore
    .listNativeSourceConnections(candidateId)
    .some((connection) => connection.platform !== platform && connection.receipt.factCount > 0);
  return profileFromOtherPlatform ? 'connect_only' : 'profile';
}

export function nativeConnectionLabel(platform: NativePlatform): string {
  return platform === 'hh' ? 'Подключено: hh.ru' : 'Подключено: LinkedIn';
}

/** Connects the platform without touching the profile and describes the result. */
export function connectNativeOnly(
  candidateStore: CandidateStore,
  candidateId: string,
  receipt: NativeSourceReceiptInput,
) {
  const connection = candidateStore.connectNativeSourceOnly(
    candidateId,
    receipt,
    nativeConnectionLabel(receipt.platform),
  );
  return {
    connectOnly: true as const,
    factCount: 0,
    connection: nativeSourceConnectionView(connection),
  };
}
