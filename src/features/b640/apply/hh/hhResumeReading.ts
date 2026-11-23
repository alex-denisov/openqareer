import {
  HH_REVIEW_RESUMES_MAX,
  HH_REVIEW_SECTIONS_MAX_LENGTH,
  HH_REVIEW_TEXT_MAX_LENGTH,
  type HhResumeContent,
} from '../../../../../shared/hhCandidateSession';
import type { HhResumeItem } from '../../../connections/hhSessionPoll';
import { readHhResumeContent } from './hhDesktop';

/**
 * B678: содержимое резюме для сверки читается в окне hh.ru кандидата как у человека: по одной
 * странице с паузой 2–4 с, не больше пяти за открытие листа, первая же неудача останавливает чтение.
 * Прочитанное держится час и не перечитывается при повторном открытии листа.
 */
export interface ReadPace {
  readonly minMs: number;
  readonly maxMs: number;
}

export const HUMAN_PACE: ReadPace = { minMs: 2_000, maxMs: 4_000 };
const CACHE_MS = 60 * 60 * 1_000;

const cache = new Map<string, { readonly content: HhResumeContent; readonly at: number; readonly updated?: string }>();

/** Только для тестов: прочитанное между тестами не переносится. */
export function forgetReadResumes(): void {
  cache.clear();
}

function cached(item: HhResumeItem, now: number): HhResumeContent | undefined {
  const entry = cache.get(item.id);
  const fresh = entry && now - entry.at < CACHE_MS && entry.updated === item.updatedLabel;
  return fresh ? entry.content : undefined;
}

const pause = (pace: ReadPace) =>
  new Promise<void>((resolve) => setTimeout(resolve, pace.minMs + Math.random() * (pace.maxMs - pace.minMs)));

/** Для сверки — начало текста и разделы, по которым считаются правки; текст целиком страница сохраняется только у выбранного. */
export function forReview(content: HhResumeContent): HhResumeContent {
  const { sections, ...rest } = content;
  const fits = sections && JSON.stringify(sections).length <= HH_REVIEW_SECTIONS_MAX_LENGTH;
  return { ...rest, ...(fits ? { sections } : {}), text: content.text.slice(0, HH_REVIEW_TEXT_MAX_LENGTH) };
}

export async function readResumesForReview(
  items: readonly HhResumeItem[],
  pace: ReadPace = HUMAN_PACE,
): Promise<HhResumeContent[]> {
  const contents: HhResumeContent[] = [];
  let pageReads = 0;
  for (const item of items.slice(0, HH_REVIEW_RESUMES_MAX)) {
    const known = cached(item, Date.now());
    if (known) {
      contents.push(known);
      continue;
    }
    if (pageReads > 0 && pace.maxMs > 0) await pause(pace);
    pageReads += 1;
    try {
      const content = await readHhResumeContent(item);
      cache.set(item.id, { content, at: Date.now(), updated: item.updatedLabel });
      contents.push(content);
    } catch {
      // Страница не прочиталась (капча, вход, сбой): дальше hh.ru не трогаем, сверка по прочитанным.
      break;
    }
  }
  return contents;
}
