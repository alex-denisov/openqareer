import type { MatchedVacancyItem } from './multiSourceVacancyEngine';

/**
 * Подбор отдаётся страницами, помещающимися в один ответ.
 *
 * Прод отвечал на `/api/v1/candidate/matched-vacancies` одним телом в 794 319
 * байт. Маршрут владельца обрывает соединение примерно на 20 460 байт — на
 * приложении, на статике и одинаково при `gzip` и без него, — поэтому экран
 * «Вакансии» не получал ни одной записи (INC-029). Тот же обрыв заставил
 * релизную сборку резать ассеты на части по 12 288 байт, и подбор берёт ровно
 * этот проверенный размер: страница, которая заведомо доходит.
 *
 * Заодно из ответа уходит то, чего интерфейс не показывает: сводка описания,
 * полный список навыков кластера и все требования — совпавшие и нет. Их было
 * около полутора килобайт на запись, а на экране видно не больше трёх; чтобы
 * покрытие осталось честным, вместо списков едет их счёт.
 */
export const MATCHED_PAGE_BYTE_BUDGET = 12_288;

/** Столько требований печатает карточка вакансии — и совпавших, и нет. */
const VISIBLE_POINTS = 3;

export interface MatchedVacancyPage {
  readonly items: MatchedVacancyItem[];
  readonly total: number;
  readonly offset: number;
  /** Смещение следующей страницы; `null` — пул кончился. */
  readonly nextOffset: number | null;
}

function trim(item: MatchedVacancyItem): MatchedVacancyItem {
  return {
    cluster: {
      ...item.cluster,
      descriptionSummary: '',
      skills: [],
    },
    explanation: {
      ...item.explanation,
      matchingPoints: item.explanation.matchingPoints.slice(0, VISIBLE_POINTS),
      missingPoints: item.explanation.missingPoints.slice(0, VISIBLE_POINTS),
      matchingCount: item.explanation.matchingPoints.length,
      missingCount: item.explanation.missingPoints.length,
    },
  };
}

export function buildMatchedVacancyPage(
  all: readonly MatchedVacancyItem[],
  offset: number,
  budgetBytes: number = MATCHED_PAGE_BYTE_BUDGET,
): MatchedVacancyPage {
  const start = Math.max(0, Math.trunc(offset));
  const items: MatchedVacancyItem[] = [];
  // Открывающая и закрывающая скобки массива входят в тот же бюджет.
  let size = 2;

  for (let index = start; index < all.length; index += 1) {
    const trimmed = trim(all[index]);
    const cost = Buffer.byteLength(JSON.stringify(trimmed), 'utf8') + (items.length > 0 ? 1 : 0);
    // Запись, которая одна не влезает в бюджет, всё равно уходит первой: иначе
    // страница вернулась бы пустой и пул выглядел бы кончившимся.
    if (items.length > 0 && size + cost > budgetBytes) break;
    items.push(trimmed);
    size += cost;
  }

  const nextOffset = start + items.length;
  return {
    items,
    total: all.length,
    offset: start,
    nextOffset: nextOffset < all.length ? nextOffset : null,
  };
}
