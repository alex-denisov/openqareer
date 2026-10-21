import { Warning } from '@phosphor-icons/react';
import type { vacancyTrustSignals } from '../../../shared/vacancyTrustSignals';

/** Stale, phantom or suspicious vacancy warning, shown in the row and the 390 push. */
export function DetailTrustAlert({
  trust,
}: {
  readonly trust: ReturnType<typeof vacancyTrustSignals>;
}) {
  if (trust.level === 'ok' || trust.reasons.length === 0) return null;
  return (
    <div
      className={`vacancies-detail-trust-alert is-${trust.level}`}
      role="status"
      data-trust-level={trust.level}
    >
      <Warning size={16} aria-hidden="true" />
      <span>{trust.reasons.join(' · ')}</span>
    </div>
  );
}
