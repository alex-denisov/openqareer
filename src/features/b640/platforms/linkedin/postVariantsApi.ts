import type { TextVariant, TextVariantList, VariantWish } from '../../../../../shared/textVariants';
import type { LinkedinDraft } from '../../../today/linkedinDraftApi';
import { apiFetch, readDataObject } from '../../../coach/apiClient';

/** Вид черновика: под ним сервер хранит варианты. */
export type DraftKind = LinkedinDraft['kind'];
export type PostVariantList = TextVariantList<null>;
export type PostVariant = TextVariant<null>;

/** Другие варианты черновика поста (a03b) или комментария (a05): вид тот же, под которым сохранены. */
export async function listPostVariants(
  kind: DraftKind,
  draftId: string,
  signal?: AbortSignal,
): Promise<PostVariantList> {
  const query = new URLSearchParams({ kind, subjectId: draftId });
  return readDataObject<PostVariantList>(
    await apiFetch(`/api/v1/candidate/text-variants?${query.toString()}`, { signal }),
  );
}

/** Новый вариант поста с пожеланием кандидата; месячную квоту черновиков не расходует. */
export async function createPostVariant(
  draftId: string,
  wish: VariantWish,
): Promise<PostVariantList & { readonly variant: PostVariant }> {
  const response = await apiFetch(
    `/api/v1/candidate/b640/linkedin/drafts/${encodeURIComponent(draftId)}/variants`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wish }),
    },
  );
  return readDataObject<PostVariantList & { readonly variant: PostVariant }>(response);
}
