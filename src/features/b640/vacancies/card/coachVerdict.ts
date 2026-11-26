import type { VacancyFitView } from '../../../../../shared/vacancyFit';
import { vacancyFitPercent, vacancyFitTier } from '../../../../../shared/vacancyFitPercent';
import { fitRows, type FitRow } from './fitRows';

/**
 * «Вывод консультанта» на шаге «Отклик» (a02d) из того же разбора требований,
 * что и процент, без вызова модели: решение, самое сильное совпадение и вопрос,
 * к которому готовиться. Названия требований в кавычках — без склонения.
 */

const OPENING: Record<ReturnType<typeof vacancyFitTier>, string> = {
  hi: 'Стоит откликаться',
  good: 'Стоит откликаться',
  mid: 'Можно откликаться с оговоркой',
  low: 'Скорее не стоит',
};

interface Ranked extends FitRow {
  readonly rank: number;
}

/** Обязательное требование первым, затем важное, затем по порядку текста. */
function ranked(view: VacancyFitView, rows: readonly FitRow[]): Ranked[] {
  const byId = new Map(view.requirements.map((item) => [item.id, item]));
  return rows
    .map((row) => {
      const requirement = byId.get(row.id);
      const mandatory = requirement?.hard || requirement?.stopFactor ? 2 : 0;
      return { ...row, rank: mandatory + (requirement?.importance === 'high' ? 1 : 0) };
    })
    .sort((a, b) => b.rank - a.rank);
}

function question(missing: Ranked | undefined, partial: Ranked | undefined): string | null {
  if (missing)
    return `Спросят про «${missing.text}» — в профиле этого нет, готовьте честный ответ.`;
  if (partial)
    return `Спросят про «${partial.text}» — в профиле это есть частично, подготовьте пример.`;
  return null;
}

export function coachVerdict(view: VacancyFitView | undefined): string | null {
  const percent = vacancyFitPercent(view);
  if (percent === null) return null;
  const { matched, total } = view!.result!.coverage;
  const rows = ranked(view!, fitRows(view));
  const strongest = rows.find((row) => row.status === 'matched');
  const missing = rows.find((row) => row.status === 'unmatched');
  const partial = rows.find((row) => row.status === 'partial');
  const count = `${matched} из ${total} требований есть в профиле`;
  const head = strongest
    ? `${OPENING[vacancyFitTier(percent)]}: ${count}, самое сильное — «${strongest.text}».`
    : `${OPENING[vacancyFitTier(percent)]}: ${count}.`;
  const tail = question(missing, partial);
  return tail ? `${head} ${tail}` : head;
}
