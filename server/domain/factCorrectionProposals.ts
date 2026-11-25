import type { FactCorrectionProposal, FactCorrectionTarget } from '../../shared/factCorrection';
import {
  applyStated,
  correctedCopy,
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
}

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
  const targets: FactCorrectionTarget[] = [
    { kind: 'about' },
    { kind: 'headline' },
    ...(draft?.projects ?? []).map(({ id }) => ({ kind: 'project' as const, id })),
  ];
  return [
    ...memory.map((item) => ({
      target: { kind: 'memory' as const, id: item.id },
      text: item.statement,
    })),
    ...targets.flatMap((target) => {
      const text = draftText(draft, target);
      return text ? [{ target, text }] : [];
    }),
  ];
}

function placeOf(source: FactSource, target: FactCorrectionTarget): string | null {
  const draft = source.resume?.draft;
  if (target.kind === 'about') return 'О себе';
  if (target.kind === 'headline') return 'Заголовок';
  if (target.kind === 'project')
    return draft?.projects?.find(({ id }) => id === target.id)?.name ?? null;
  const entry = draft?.experience.find(
    ({ bulletMemoryIds, descriptionMemoryId }) =>
      bulletMemoryIds.includes(target.id) || descriptionMemoryId === target.id,
  );
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
  const hidden = new Set(source.memory.filter(({ sensitive }) => sensitive).map(({ id }) => id));
  const found = factCopies(source).flatMap(({ target, text }) => {
    const place = placeOf(source, target);
    const after = applyStated(text, stated, percent);
    if (after === null || place === null || (target.kind === 'memory' && hidden.has(target.id))) {
      return [];
    }
    return [{ target, before: text, after, place }];
  });
  return found
    .reduce<FactCorrectionProposal[]>((kept, item) => {
      const covered = kept.some((other) => {
        const changes = numberChanges(other.before, other.after) ?? [];
        return correctedCopy(item.before, changes) !== null;
      });
      return covered ? kept : [...kept, item];
    }, [])
    .slice(0, MAX_PROPOSALS);
}
