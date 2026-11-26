import {
  bulletKey,
  type FactRewriteProposal,
} from '../../../../server/domain/experienceFactRewrite';
import { requestFactRewrite } from '../../resume/experienceFactRewriteApi';
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

/** «Отклонить»: факты остаются в памяти, пункт из них больше не предлагается. */
export async function declineResumeEdit(edit: ResumeEdit): Promise<void> {
  const draft = await freshDraft();
  await saveResumeStudioDraft({
    ...draft,
    declinedFactIds: [...new Set([...(draft.declinedFactIds ?? []), ...edit.sourceFactIds])],
  });
}
