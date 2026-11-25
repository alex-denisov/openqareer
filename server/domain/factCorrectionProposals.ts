import type { FactCorrectionProposal, FactCorrectionTarget } from '../../shared/factCorrection';
import {
  applyStated,
  correctedCopy,
  type CopyPlace,
  numberChanges,
  saysPercent,
  statedCorrection,
} from './factCorrection';
import type { ResumeDraft } from './resumeDraft';

/** Что нужно знать о кандидате, чтобы найти записи с исправляемым фактом. */
export interface FactSource {
  readonly memory: ReadonlyArray<{
    readonly id: string;
    readonly statement: string;
    readonly sensitive?: boolean;
  }>;
  readonly resume?: { readonly draft: ResumeDraft } | null;
}

export interface FactCopy {
  readonly target: FactCorrectionTarget;
  readonly text: string;
  /** К чему относится запись: место работы или проект; не привязана — `null`. */
  readonly placeKey: string | null;
  /** Чувствительная или отклонённая запись: правка другой записи её не меняет. */
  readonly locked: boolean;
}

export function copyPlace(left: string | null, right: string | null): CopyPlace {
  if (left === null || right === null) return 'unknown';
  return left === right ? 'same' : 'other';
}

function placeKeyOf(draft: ResumeDraft | undefined, target: FactCorrectionTarget): string | null {
  if (target.kind === 'project') return `project:${target.id}`;
  if (target.kind !== 'memory') return null;
  return placeEntry(draft, target.id)?.id ?? null;
}

const placeEntry = (draft: ResumeDraft | undefined, memoryId: string) =>
  draft?.experience.find(
    ({ bulletMemoryIds, descriptionMemoryId }) =>
      bulletMemoryIds.includes(memoryId) || descriptionMemoryId === memoryId,
  );

export function draftText(
  draft: ResumeDraft | undefined,
  target: FactCorrectionTarget,
): string | null {
  if (!draft || target.kind === 'memory') return null;
  if (target.kind === 'project') {
    return draft.projects?.find(({ id }) => id === target.id)?.description ?? null;
  }
  return draft.candidate[target.kind] ?? null;
}

/** Все записи кандидата, где может стоять факт: память, «О себе», заголовок, проекты. */
export function factCopies({ memory, resume }: FactSource): readonly FactCopy[] {
  const draft = resume?.draft;
  const declined = new Set(draft?.declinedFactIds ?? []);
  const targets: FactCorrectionTarget[] = [
    { kind: 'about' },
    { kind: 'headline' },
    ...(draft?.projects ?? []).map(({ id }) => ({ kind: 'project' as const, id })),
  ];
  return [
    ...memory.map((item) => ({
      target: { kind: 'memory' as const, id: item.id },
      text: item.statement,
      placeKey: placeKeyOf(draft, { kind: 'memory', id: item.id }),
      locked: item.sensitive === true || declined.has(item.id),
    })),
    ...targets.flatMap((target) => {
      const text = draftText(draft, target);
      return text ? [{ target, text, placeKey: placeKeyOf(draft, target), locked: false }] : [];
    }),
  ];
}

export function placeOf(source: FactSource, target: FactCorrectionTarget): string | null {
  const draft = source.resume?.draft;
  if (target.kind === 'about') return 'О себе';
  if (target.kind === 'headline') return 'Заголовок';
  if (target.kind === 'project')
    return draft?.projects?.find(({ id }) => id === target.id)?.name ?? null;
  const entry = placeEntry(draft, target.id);
  return entry ? entry.employer || entry.title || null : null;
}

const MAX_PROPOSALS = 4;

/**
 * Карточки правки по словам кандидата «не 80 %, а 40 %»: одна на факт. Копии того же факта правка меняет
 * сама; разные факты с тем же числом — разные карточки, решает кандидат.
 */
export function factCorrectionProposals(
  source: FactSource,
  message: string,
): readonly FactCorrectionProposal[] {
  const stated = statedCorrection(message);
  if (!stated) return [];
  const percent = saysPercent(message);
  const found = factCopies(source).flatMap(({ target, text, placeKey, locked }) => {
    const place = placeOf(source, target);
    const after = applyStated(text, stated, percent);
    if (after === null || place === null || locked) return [];
    return [{ placeKey, proposal: { target, before: text, after, place } }];
  });
  return found
    .reduce<(typeof found)[number][]>((kept, item) => {
      const covered = kept.some((other) => {
        const changes = numberChanges(other.proposal.before, other.proposal.after) ?? [];
        const relation = copyPlace(other.placeKey, item.placeKey);
        return correctedCopy(item.proposal.before, changes, relation) !== null;
      });
      return covered ? kept : [...kept, item];
    }, [])
    .slice(0, MAX_PROPOSALS)
    .map(({ proposal }) => proposal);
}
