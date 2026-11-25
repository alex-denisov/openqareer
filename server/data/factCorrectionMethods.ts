import type { FactCorrectionChange, FactCorrectionOutcome, FactCorrectionTarget } from '../../shared/factCorrection';
import { correctedCopy, numberChanges, suggestedCopy } from '../domain/factCorrection';
import { copyPlace, factCopies, placeOf, type FactCopy } from '../domain/factCorrectionProposals';
import type { ResumeDraft } from '../domain/resumeDraft';
import { buildResumeStudioProjection } from '../domain/resumeStudio';
import { FactCorrectionCopies } from './factCorrectionCopies';
import type { MemoryMethodDeps } from './sqliteCandidateStoreMemoryMethods';
import { CandidateStoreConflictError } from './store/errors';

/** Записанное не совпало с исправленным: правка отменена целиком. */
export class FactCorrectionNotSavedError extends Error {
  constructor() {
    super('fact_correction_not_saved');
  }
}

/** Запись профиля, не привязанная к месту работы. */
const UNPLACED = 'Профиль';

type Deps = Pick<
  MemoryMethodDeps,
  'database' | 'sealedText' | 'conversations' | 'profileChangeLog' | 'requireCandidate' | 'transaction' | 'getSnapshot' | 'saveResumeDraft'
>;

function withDraftText(draft: ResumeDraft, target: FactCorrectionTarget, text: string): ResumeDraft {
  if (target.kind === 'memory') return draft;
  if (target.kind === 'project') {
    return {
      ...draft,
      projects: draft.projects?.map((item) =>
        item.id === target.id ? { ...item, description: text } : item,
      ),
    };
  }
  return { ...draft, candidate: { ...draft.candidate, [target.kind]: text } };
}

const sameTarget = (a: FactCorrectionTarget, b: FactCorrectionTarget): boolean =>
  a.kind === b.kind && ('id' in a ? a.id : '') === ('id' in b ? b.id : '');

function write(deps: Deps, candidateId: string, changes: readonly FactCorrectionChange[], main?: FactCorrectionTarget) {
  const memory = changes.flatMap((change) => change.target.kind === 'memory' ? [{ ...change, id: change.target.id }] : []);
  // Доверие к копиям прежнее: открытый вопрос от правки числа фактом не становится.
  const keep = memory.filter(({ target }) => !main || !sameTarget(target, main)).map(({ id }) => id);
  const states = deps.profileChangeLog.readFactStates(candidateId, keep);
  for (const { id, after } of memory) {
    if (!deps.conversations.changeMemory(candidateId, id, { action: 'correct', statement: after }))
      throw new CandidateStoreConflictError();
  }
  deps.profileChangeLog.writeFactStates(candidateId, states, new Date().toISOString());
  const snapshot = deps.getSnapshot(candidateId);
  const draft = snapshot.resume?.draft;
  if (!draft) return;
  const next = changes.reduce((value, { target, after }) => withDraftText(value, target, after), draft);
  deps.profileChangeLog.recordDraftChanges(candidateId, draft, next, 'candidate');
  const projection = buildResumeStudioProjection({ ...next, evidence: snapshot.memory });
  deps.saveResumeDraft(candidateId, next, projection.evidenceSnapshot);
}

/** Прочитанное после записи обязано совпасть, иначе транзакция откатывается. */
function verify(deps: Deps, candidateId: string, changes: readonly FactCorrectionChange[]) {
  const copies = factCopies(deps.getSnapshot(candidateId));
  const holds = changes.every(({ target, after }) =>
    copies.some((copy) => sameTarget(copy.target, target) && copy.text === after));
  if (!holds) throw new FactCorrectionNotSavedError();
}

function correctFact(
  deps: Deps,
  candidateId: string,
  input: FactCorrectionChange,
): FactCorrectionOutcome {
  deps.requireCandidate(candidateId);
  return deps.transaction(() => {
    const source = deps.getSnapshot(candidateId);
    const copies = factCopies(source);
    const own = copies.find((copy) => sameTarget(copy.target, input.target));
    const after = input.after.trim();
    const declined = source.resume?.draft.declinedFactIds ?? [];
    if (!own || own.text !== input.before || !after) throw new CandidateStoreConflictError();
    if (own.target.kind === 'memory' && declined.includes(own.target.id))
      throw new CandidateStoreConflictError();
    const numbers = numberChanges(own.text, after) ?? [];
    const others = copies.filter(({ target, locked }) => !locked && !sameTarget(target, own.target));
    const fixedOf = ({ text, placeKey }: FactCopy) =>
      correctedCopy(text, numbers, copyPlace(own.placeKey, placeKey));
    const changes: FactCorrectionChange[] = [
      { target: own.target, before: own.text, after },
      ...others.flatMap((copy) => {
        const fixed = fixedOf(copy);
        return fixed === null ? [] : [{ target: copy.target, before: copy.text, after: fixed }];
      }),
    ];
    const proposals = others.flatMap((copy) => {
      const fixed = fixedOf(copy) === null ? suggestedCopy(copy.text, numbers) : null;
      const place = placeOf(source, copy.target) ?? UNPLACED;
      return fixed === null ? [] : [{ target: copy.target, before: copy.text, after: fixed, place }];
    });
    write(deps, candidateId, changes, own.target);
    const stores = new FactCorrectionCopies(deps.database, deps.sealedText);
    const counts = stores.apply(candidateId, changes, { target: own.target, placeKey: own.placeKey, numbers });
    verify(deps, candidateId, changes);
    return { ...counts, changes, proposals };
  });
}

/** «Отменить»: каждая запись ещё та, что поставила правка, и возвращается к прежнему тексту. */
function revertFactCorrection(deps: Deps, candidateId: string, id: string): void {
  deps.requireCandidate(candidateId);
  deps.transaction(() => {
    const stores = new FactCorrectionCopies(deps.database, deps.sealedText);
    const changes = stores.changesOf(candidateId, id);
    if (!changes) throw new CandidateStoreConflictError();
    const back = changes.map(({ target, before, after }) => ({ target, before: after, after: before }));
    const copies = factCopies(deps.getSnapshot(candidateId));
    const current = back.every(({ target, before }) =>
      copies.some((copy) => sameTarget(copy.target, target) && copy.text === before));
    if (!current) throw new CandidateStoreConflictError();
    write(deps, candidateId, back);
    stores.revert(candidateId, id);
    verify(deps, candidateId, back);
  });
}

export function createFactCorrectionMethods(deps: Deps) {
  return {
    correctFact: (candidateId: string, input: FactCorrectionChange): FactCorrectionOutcome =>
      correctFact(deps, candidateId, input),
    revertFactCorrection: (candidateId: string, id: string): void =>
      revertFactCorrection(deps, candidateId, id),
  };
}

export type FactCorrectionMethods = ReturnType<typeof createFactCorrectionMethods>;
