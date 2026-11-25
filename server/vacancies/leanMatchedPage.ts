/**
 * B725: облегчённая строка подбора для кабинета B640.
 *
 * Прод 19.11, adenisov.test: 897 строк шли 154 страницами по 5–6 строк, строка
 * весила 6,7–8 КБ. Больше половины веса — то, чего «Подборка» B640 не
 * читает: пункты разбора (`fitView.points` 1,8 КБ), пороги результата,
 * `matchingFacts`, `matchingPoints`, `missingPoints`. Их читает только старый
 * кабинет, а аккаунт с флагом B640 видит его лишь без сессии или без
 * подтверждённой почты, и тогда пул не читает вовсе.
 *
 * Облегчённая строка — в среднем 2,1 КБ, поэтому страница режется не по байтам,
 * а ровно по 20 строк, и план страниц считается из одного числа строк.
 */
import type { VacancyFitResult, VacancyFitView } from '../../shared/vacancyFit';
import type { MatchedVacancyPage } from './matchedVacancyPage';
import { MATCHED_PAGE_ITEM_LIMIT, trim } from './matchedVacancyPage';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';

export const LEAN_PAGE_SIZE = MATCHED_PAGE_ITEM_LIMIT;

/** Смещения всех страниц: 0, 20, 40… — как и разрез страницы, из одного числа строк. */
export function leanPageOffsets(total: number): number[] {
  const pages = Math.max(1, Math.ceil(total / LEAN_PAGE_SIZE));
  return Array.from({ length: pages }, (_, index) => index * LEAN_PAGE_SIZE);
}

/** Строка без описания, навыков и списков требований; их счёт остаётся. */
export function leanRow(item: MatchedVacancyItem): MatchedVacancyItem {
  return withoutPointLists(trim(item));
}

/**
 * Уже урезанная строка (обычная страница запечатанного списка) без списков требований.
 * `trim` второй раз не идёт: формат работы он выводит из описания, а его там уже нет.
 */
export function leanTrimmedRow(trimmed: MatchedVacancyItem): MatchedVacancyItem {
  return withoutPointLists(trimmed);
}

/** `trim` already put the full counts next to the cut lists; they stay when the lists go. */
function withoutPointLists(trimmed: MatchedVacancyItem): MatchedVacancyItem {
  const { matchingFacts: _facts, partialPoints: _partial, ...explanation } = trimmed.explanation;
  return {
    ...trimmed,
    explanation: {
      ...explanation,
      matchingPoints: [],
      missingPoints: [],
      matchingCount: explanation.matchingCount ?? trimmed.explanation.matchingPoints.length,
      missingCount: explanation.missingCount ?? trimmed.explanation.missingPoints.length,
    },
  };
}

export function buildLeanMatchedPage(
  all: readonly MatchedVacancyItem[],
  offset: number,
): MatchedVacancyPage {
  const start = Math.max(0, Math.trunc(offset));
  const items = all.slice(start, start + LEAN_PAGE_SIZE).map(leanRow);
  const nextOffset = start + items.length;
  return {
    items,
    total: all.length,
    offset: start,
    nextOffset: nextOffset < all.length ? nextOffset : null,
    ...(start === 0 ? { pageOffsets: leanPageOffsets(all.length) } : {}),
  };
}

/**
 * Разбор в строке: состояние и итог для процента и подписи «нет профиля».
 * Пороги, оценки, выведенные требования и обязанности строка не показывает;
 * раскрытая карточка читает полный разбор своим запросом.
 */
export function leanFitView(view: VacancyFitView): VacancyFitView {
  const { points: _points, ...rest } = view;
  if (!view.result) return { ...rest, requirements: [] };
  const { gates: _gates, implied: _implied, duties: _duties, wishes: _wishes, ...result } = view.result;
  // Без `gates`: тип требует поле, а строке B640 оно не нужно (B725).
  return {
    ...rest,
    requirements: [],
    result: { ...result, assessments: [] } as unknown as VacancyFitResult,
  };
}
