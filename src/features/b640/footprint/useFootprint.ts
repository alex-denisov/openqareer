import { useEffect } from 'react';
import type { CandidateFootprintAudit } from '../../../../shared/candidateFootprint';
import type { FootprintRiskSummary } from '../../../../shared/footprintRisk';
import { useLoad, type Load } from '../today/useLoad';
import {
  getAccountCapabilityConsents,
  getCandidateFootprintPlan,
  getFootprintRisks,
} from './footprintApi';
import type { PlanItem } from './footprintModel';

export interface FootprintData {
  readonly plan: readonly PlanItem[];
  readonly consentGranted: boolean;
  readonly consentVersion: string;
  /** Когда дано действующее согласие; `null` — не дано или дата неизвестна. */
  readonly consentGrantedAt: string | null;
  readonly audit: CandidateFootprintAudit | null;
  readonly summary: FootprintRiskSummary;
}

/** Дата согласия — для строки «Согласие дано»; её сбой экран не роняет. */
async function consentDate(): Promise<string | null> {
  try {
    const consents = await getAccountCapabilityConsents();
    const active = consents.find(
      (consent) => consent.capability === 'digital_footprint' && consent.revokedAt === null,
    );
    return active?.grantedAt ?? null;
  } catch {
    return null;
  }
}

async function loadFootprint(): Promise<FootprintData> {
  const [plan, summary, grantedAt] = await Promise.all([
    getCandidateFootprintPlan(),
    getFootprintRisks(),
    consentDate(),
  ]);
  return {
    plan: plan.plan,
    consentGranted: plan.consent.granted,
    consentVersion: plan.consent.versionId,
    consentGrantedAt: plan.consent.granted ? grantedAt : null,
    audit: plan.audit,
    summary,
  };
}

export const FOOTPRINT_POLL_MS = 3000;
/** Отметка или отмена на любом экране следа: живой экран перечитывает данные. */
export const FOOTPRINT_CHANGED = 'b640:footprint-changed';

export function announceFootprintChanged(): void {
  window.dispatchEvent(new Event(FOOTPRINT_CHANGED));
}

/** След кандидата: план, согласие, сводка; пока идёт поиск — перечитываем на месте. */
export function useFootprint(): Load<FootprintData> {
  const load = useLoad(loadFootprint);
  const checking = load.state === 'ready' && load.data.summary.state === 'checking';
  const { retry } = load;
  // Интервал, а не цепочка: сбой одного чтения опрос не останавливает.
  useEffect(() => {
    if (!checking) return undefined;
    const timer = setInterval(retry, FOOTPRINT_POLL_MS);
    return () => clearInterval(timer);
  }, [checking, retry]);
  useEffect(() => {
    window.addEventListener(FOOTPRINT_CHANGED, retry);
    return () => window.removeEventListener(FOOTPRINT_CHANGED, retry);
  }, [retry]);
  return load;
}
