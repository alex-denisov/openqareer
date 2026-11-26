import {
  createDraft,
  DraftApiError,
  listDraftTopics,
  listDrafts,
  type LinkedinDraft,
} from '../../../today/linkedinDraftApi';
import { useLoad } from '../../today/useLoad';

const LIST_LIMIT = 50;

/** Черновики постов и комментариев: сервер отдаёт до 50 последних, экран показывает по 20. */
const readDrafts = (): Promise<readonly LinkedinDraft[]> => listDrafts(LIST_LIMIT);

export function useLinkedinDrafts() {
  return useLoad(readDrafts);
}

const NO_TOPICS = 'Тем для поста пока нет';

/** Понятный текст ошибки черновика; сервер уже пишет по-русски про лимиты. */
export function draftErrorText(error: unknown): string {
  if (error instanceof DraftApiError && error.status !== 500 && error.message) return error.message;
  return 'Черновик не получился';
}

/** Готовит черновик поста по первой подходящей теме; на площадку ничего не уходит. */
export async function prepareDraft(): Promise<LinkedinDraft> {
  const { items } = await listDraftTopics(1, 0);
  const topic = items[0];
  if (!topic) throw new DraftApiError(404, NO_TOPICS);
  return createDraft({ kind: 'post', topic: topic.title, topicId: topic.id, inputType: 'topic' });
}
