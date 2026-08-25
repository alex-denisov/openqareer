import { CheckCircle, Question, WarningCircle } from '@phosphor-icons/react';
import type { RouteNotice } from './connectorSession';

interface RouteNoticeLineProps {
  readonly notice: RouteNotice;
  /** Inside the connector toolbar the line shares one row with the buttons. */
  readonly compact?: boolean;
}

function RouteToneIcon({ tone, size }: { tone: RouteNotice['tone']; size: number }) {
  if (tone === 'ok') return <CheckCircle size={size} weight="fill" />;
  if (tone === 'blocked') return <WarningCircle size={size} weight="fill" />;
  // An unmeasured route must not borrow the icon of a confirmed one, and a
  // probe still in flight has nothing to show yet (docs/agents/design-system.md §7).
  if (tone === 'unknown') return <Question size={size} weight="bold" />;
  return null;
}

/**
 * One place decides how a route tone looks, so LinkedIn and hh.ru cannot drift
 * apart again — before B167 the same four-branch ternary lived in four places
 * and LinkedIn had started showing a shield next to «Проверяем доступность…».
 */
export function RouteNoticeLine({ notice, compact = false }: RouteNoticeLineProps) {
  return (
    <p className={`career-modal-network-status${compact ? ' is-compact' : ''}`}>
      <RouteToneIcon tone={notice.tone} size={compact ? 16 : 18} />
      <span>{notice.text}</span>
    </p>
  );
}
