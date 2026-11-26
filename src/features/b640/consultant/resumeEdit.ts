import {
  bulletKey,
  type FactRewriteProposal,
} from '../../../../server/domain/experienceFactRewrite';
import { requestFactReword, requestFactRewrite } from '../../resume/experienceFactRewriteApi';
import { getResumeStudio, saveResumeStudioDraft } from '../../resume/resumeApi';
import { forgetSharedRead } from '../../resume/sharedRead';
import type { ResumeDraft } from '../../resume/resumeTypes';

/** Один пункт из правки консультанта: куда встанет, новый текст и факты, из которых он собран. */
export interface ResumeEdit {
  readonly proposalId: string;
  /** Адрес пункта в предложении: применяется только он. */
  readonly key: string;
  readonly place: string;
  readonly text: string;
  readonly sourceFactIds: readonly string[];
  /** B786: правка переписывает эту строку резюме; `before` — её текст сейчас («Было»). */
  readonly replaces?: string;
  readonly before?: string;
}

async function freshDraft(): Promise<ResumeDraft> {
  forgetSharedRead('resume');
  const { draft } = await getResumeStudio();
  if (!draft) throw new Error('profile_draft_missing');
  return draft;
}

function editOf(
  proposal: FactRewriteProposal,
  draft: ResumeDraft,
  factId: string,
): ResumeEdit | null {
  for (const place of proposal.places) {
    const index = place.bullets.findIndex((bullet) => bullet.sourceFactIds.includes(factId));
    const bullet = place.bullets[index];
    if (!bullet) continue;
    const entry = draft.experience.find((item) => item.id === place.experienceId);
    return {
      proposalId: proposal.id,
      key: bulletKey(place.experienceId, index),
      place: entry?.employer || entry?.title || '',
      text: bullet.text,
      sourceFactIds: bullet.sourceFactIds,
    };
  }
  return null;
}

/** Готовая правка консультанта из названного факта; `null` — пункта из него нет. */
export async function loadResumeEdit(factId: string): Promise<ResumeEdit | null> {
  const proposal = await requestFactRewrite();
  return proposal ? editOf(proposal, await freshDraft(), factId) : null;
}

/** B786: строка места уже переписана и не отменена — карточка показывает «Применено». */
export interface AppliedReword {
  readonly appliedRewriteId: string;
}

/** Применённая новая формулировка, чья строка всё ещё первая в месте. */
function appliedRewordOf(draft: ResumeDraft, experienceId: string): AppliedReword | null {
  const first = draft.experience.find((item) => item.id === experienceId)?.bulletMemoryIds[0];
  if (!first) return null;
  const record = (draft.factRewrites ?? []).find((rewrite) =>
    rewrite.bullets.some(
      (bullet) =>
        bullet.replacedMemoryId &&
        bullet.experienceId === experienceId &&
        bullet.memoryId === first,
    ),
  );
  return record ? { appliedRewriteId: record.id } : null;
}

/** Новая формулировка первой строки места; `null` — строк в месте нет. */
export async function loadResumeReword(
  experienceId: string,
): Promise<ResumeEdit | AppliedReword | null> {
  const draft = await freshDraft();
  const applied = appliedRewordOf(draft, experienceId);
  if (applied) return applied;
  const reword = await requestFactReword(experienceId);
  const bullet = reword?.proposal.places[0]?.bullets[0];
  if (!reword || !bullet) return null;
  const entry = draft.experience.find((item) => item.id === experienceId);
  return {
    proposalId: reword.proposal.id,
    key: bulletKey(experienceId, 0),
    place: entry?.employer || entry?.title || '',
    text: bullet.text,
    sourceFactIds: bullet.sourceFactIds,
    ...(bullet.replacesMemoryId ? { replaces: bullet.replacesMemoryId } : {}),
    before: reword.before,
  };
}

/** «Отклонить»: факты остаются в памяти, пункт из них больше не предлагается. */
export async function declineResumeEdit(edit: ResumeEdit): Promise<void> {
  // B786: отклонённая новая формулировка строки ничего не меняет в резюме.
  if (edit.replaces) return;
  const draft = await freshDraft();
  await saveResumeStudioDraft({
    ...draft,
    declinedFactIds: [...new Set([...(draft.declinedFactIds ?? []), ...edit.sourceFactIds])],
  });
}
