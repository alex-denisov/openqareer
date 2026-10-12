import type { CandidateBillingSummary } from '../shell/candidateBillingApi';
import { TariffUpgradeFlow, type TariffUpgradeContext } from './TariffUpgradeFlow';
import './paywall.css';

export interface PaywallModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onNavigate: (view: 'tariffs') => void;
  readonly context?: TariffUpgradeContext;
  readonly summary?: CandidateBillingSummary | null;
  readonly onSummaryChanged?: (summary: CandidateBillingSummary) => void;
}

export function PaywallModal({
  isOpen,
  onClose,
  onNavigate,
  context = { kind: 'gate' },
  summary,
  onSummaryChanged,
}: PaywallModalProps) {
  if (!isOpen) return null;
  return (
    <TariffUpgradeFlow
      context={context}
      summary={summary}
      onClose={onClose}
      onNavigate={() => {
        onClose();
        onNavigate('tariffs');
      }}
      onSummaryChanged={onSummaryChanged}
    />
  );
}
