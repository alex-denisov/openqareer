import type { CandidateConnection } from '../coach/coachApi';
import { nativeImportNotice, persistLinkedInCapture } from './AccountConnections';
import {
  canImportLinkedInInBackground,
  startLinkedInBackgroundImport,
} from './linkedinBackgroundImport';

/**
 * «Импортировать заново» / «Повторить раздел» outside «Аккаунт»: the import
 * starts at once and runs out of sight; the shell reports how it ended.
 */
export function startLinkedInReimport(): void {
  void startLinkedInBackgroundImport(async (capture) =>
    nativeImportNotice('linkedin', await persistLinkedInCapture(capture)),
  );
}

/**
 * The reimport action for a LinkedIn control: the background import when the
 * desktop app holds a LinkedIn connection, else the connections screen, where
 * a first sign-in has to happen anyway.
 */
export function linkedinReimportAction(
  connections: readonly CandidateConnection[] | undefined,
  openConnections: (() => void) | undefined,
): (() => void) | undefined {
  const connected = connections?.some(
    (connection) => connection.platform === 'linkedin' && connection.status === 'connected',
  );
  return connected && canImportLinkedInInBackground() ? startLinkedInReimport : openConnections;
}
