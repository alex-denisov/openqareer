import { useEffect, useState } from 'react';
import { CaretRight, Lightning } from '@phosphor-icons/react';
import { getCandidateAutomation } from '../automation/automationApi';

export function pendingApprovalCount(
  snapshot:
    { readonly queueCounts?: { readonly pending_approval?: number } | null } | null | undefined,
): number | null {
  const count = snapshot?.queueCounts?.pending_approval;
  return typeof count === 'number' && Number.isInteger(count) && count > 0 ? count : null;
}

export function usePendingAutomationApprovalCount(): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    void getCandidateAutomation()
      .then((snapshot) => {
        if (active) setCount(pendingApprovalCount(snapshot));
      })
      .catch(() => {
        if (active) setCount(null);
      });
    return () => {
      active = false;
    };
  }, []);
  return count;
}

export function ResponsesAutomationLink({
  count,
  onOpenAutomation,
}: {
  readonly count: number | null;
  readonly onOpenAutomation?: () => void;
}) {
  if (count === null || count <= 0 || !onOpenAutomation) return null;
  const countLabel = count.toLocaleString('ru-RU');
  return (
    <button
      type="button"
      className="career-responses-automation-link"
      aria-label={'Автоматизация, ' + countLabel + ' ждут одобрения'}
      onClick={onOpenAutomation}
    >
      <span className="career-responses-automation-icon">
        <Lightning aria-hidden="true" />
      </span>
      <span className="career-responses-automation-label">Автоматизация</span>
      <strong>{countLabel} ждут</strong>
      <CaretRight aria-hidden="true" />
    </button>
  );
}
