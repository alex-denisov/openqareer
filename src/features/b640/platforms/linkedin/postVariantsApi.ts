import type { TextVariant, TextVariantList, VariantWish } from '../../../../../shared/textVariants';
import { apiFetch, readDataObject } from '../../../coach/apiClient';

export type PostVariantList = TextVariantList<null>;
export type PostVariant = TextVariant<null>;

/** Другие варианты черновика поста (B694, a03b). */
export async function listPostVariants(
  draftId: string,
  signal?: AbortSignal,
): Promise<PostVariantList> {
  const query = new URLSearchParams({ kind: 'post', subjectId: draftId });
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
