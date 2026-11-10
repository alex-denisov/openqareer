import { pluralRu } from '../../../shared/pluralRu';
import type { ResponsesPeriod } from './responsesFilterDraft';

/** The list is empty only because the period hides older closed responses (B632, finding 32). */
export function olderResponsesText(count: number, period: ResponsesPeriod): string {
  const responses = pluralRu(count, ['отклик', 'отклика', 'откликов']);
  return period === 'all' ? `Есть ${responses}` : `Есть ${responses} старше ${period} дней`;
}

export function OlderResponsesNotice({
  count,
  period,
  onShow,
}: {
  readonly count: number;
  readonly period: ResponsesPeriod;
  readonly onShow: () => void;
}) {
  if (count <= 0 || period === 'all') return null;
  return (
    <section className="career-responses-empty" role="status">
      <h2>{olderResponsesText(count, period)}</h2>
      <p>За выбранный период подходящих откликов нет.</p>
      <div className="career-responses-empty-actions">
        <button
          type="button"
          className="career-btn career-btn-primary career-btn-sm"
          onClick={onShow}
        >
          Показать
        </button>
      </div>
    </section>
  );
}
