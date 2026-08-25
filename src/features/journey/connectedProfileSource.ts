import type { CandidateConnection } from '../coach/coachApi';

export type ProfileSourcePlatform = 'hh' | 'linkedin';

/**
 * A platform this candidate has already imported from, as the server holds it.
 * The wizard asks for a source; a snapshot the account already carries **is**
 * that source, and asking for it again is asking the candidate to repeat work
 * they finished (owner report, B157).
 */
export interface ConnectedProfileSource {
  readonly platform: ProfileSourcePlatform;
  readonly factCount: number;
  readonly lastImportedAt: string;
}

/**
 * The snapshot import the account already holds, if any.
 *
 * `access_mode` in `candidate_source_connections` is constrained to
 * `native_session_snapshot`, so the wizard's old filter — "connected **and
 * not** a native session snapshot" — could never match a real row. The restore
 * branch was dead, and a candidate with hh.ru connected saw an empty wizard
 * that claimed nothing was connected (B157).
 */
export function connectedProfileSource(
  connections: readonly CandidateConnection[],
): ConnectedProfileSource | undefined {
  for (const connection of connections) {
    if (connection.status !== 'connected') continue;
    if (connection.accessMode !== 'native_session_snapshot') continue;
    if (connection.factCount <= 0) continue;
    return {
      platform: connection.platform,
      factCount: connection.factCount,
      lastImportedAt: connection.lastImportedAt,
    };
  }
  return undefined;
}

/** The candidate-facing sentence for a source the account already carries. */
export function connectedProfileSourceNotice(source: ConnectedProfileSource): string {
  const name = source.platform === 'hh' ? 'hh.ru' : 'LinkedIn';
  return `${name} уже подключён: в профиле ${source.factCount} ${factNoun(source.factCount)} из этого источника. Можно продолжить — повторный импорт не нужен.`;
}

function factNoun(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return 'фактов';
  if (last === 1) return 'факт';
  if (last >= 2 && last <= 4) return 'факта';
  return 'фактов';
}
