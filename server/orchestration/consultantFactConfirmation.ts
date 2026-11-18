import { randomUUID } from 'node:crypto';
import type { CandidateStore } from '../data/candidateStore';

const CANDIDATE_CONFIRMED = 'candidate-confirmed';
/** Раздел журнала для записей из разговора: их правят на месте, в панели консультанта. */
export const CONSULTANT_FACT_SECTION = 'facts';

export type FactConfirmation =
  | { readonly state: 'confirmed'; readonly changeId: string }
  | { readonly state: 'not_found' }
  | { readonly state: 'not_proposed' };

/**
 * B688 «Верно» у записи из разговора: запись становится подтверждённой кандидатом,
 * а в истории профиля появляется строка, которую «Вернуть» отменяет (прежнее
 * состояние записи лежит в строке). Только своя запись и только предложенная.
 */
export function confirmConsultantFact(
  store: CandidateStore,
  candidateId: string,
  memoryId: string,
): FactConfirmation {
  return store.transaction((): FactConfirmation => {
    const fact = store.getSnapshot(candidateId).memory.find((item) => item.id === memoryId);
    if (!fact) return { state: 'not_found' };
    if (fact.status !== 'proposed') return { state: 'not_proposed' };
    const before = store.profileChangeLog.readFactStates(candidateId, [memoryId]);
    if (before.length !== 1) return { state: 'not_found' };
    const createdAt = new Date().toISOString();
    store.profileChangeLog.writeFactStates(
      candidateId,
      before.map((state) => ({ ...state, status: 'confirmed', confidence: CANDIDATE_CONFIRMED })),
      createdAt,
    );
    const changeId = randomUUID();
    store.profileChangeLog.record({
      id: changeId,
      candidateId,
      actor: 'candidate',
      section: CONSULTANT_FACT_SECTION,
      kind: 'confirmation',
      itemId: memoryId,
      label: fact.statement,
      previous: 'Не подтверждено вами',
      applied: 'Подтверждено вами',
      commandId: null,
      factStates: before,
      createdAt,
    });
    return { state: 'confirmed', changeId };
  });
}
