import { parseRemoteScope, remoteScopeLabel } from '../../../shared/remoteScope';

const REMOTE_MARK = /\(?\b(?:fully\s+)?remote\b\)?|\(?удал[её]нн?[\p{L}]*\)?|\bremote job\b/giu;

interface RemoteCluster {
  readonly canonicalLocation?: string;
  readonly isRemote: boolean;
  readonly remoteScope?: string;
}

/**
 * Одна русская подпись удалёнки (03.11): «Удалённо из любой страны»,
 * «Удалённо, только США». Без посчитанной области — место без английского
 * «Remote»: «Удалённо, Германия», а не «Germany, Remote, удаленно».
 */
export function vacancyRemoteLabel(cluster: RemoteCluster): string {
  const scope = parseRemoteScope(cluster.remoteScope);
  if (scope) return remoteScopeLabel(scope);
  const place = (cluster.canonicalLocation ?? '')
    .replace(REMOTE_MARK, ' ')
    .replace(/\s*[,;/·–—-]\s*(?=[,;/·–—-]|$)/gu, '')
    .replace(/^[\s,;/·–—-]+|[\s,;/·–—-]+$/gu, '')
    .replace(/\s+/gu, ' ');
  return place ? `Удалённо, ${place}` : 'Удалённо';
}
