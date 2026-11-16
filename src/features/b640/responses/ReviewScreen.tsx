import { MIN_PIPELINE_SAMPLE_SIZE } from '../../applications/pipelineAnalytics';
import { Icon, InfoTip, Link } from '../kit';
import { buildNodePath } from '../routes';
import { LoadGate, useListedResponses } from './FunnelScreen';
import type { ListedResponse } from './model/responseList';
import { longDate, pluralRu } from './model/responseRow';

/** Ширина полосы шагами по 5 %: атрибут `style` в кабинете запрещён. */
export function meterStep(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((value / total) * 20) * 5));
}

const FORMS = ['отклик', 'отклика', 'откликов'] as const;

function DataMeter({ count }: { readonly count: number }) {
  return (
    <div className="md-meter">
      <span className="num">{`${count} из ${MIN_PIPELINE_SAMPLE_SIZE}`}</span>
      <span
        className="meter"
        role="img"
        aria-label={`${count} ${pluralRu(count, FORMS)} из ${MIN_PIPELINE_SAMPLE_SIZE} нужных`}
      >
        <i className={`rs-w-${meterStep(count, MIN_PIPELINE_SAMPLE_SIZE)}`} />
      </span>
    </div>
  );
}

function RejectedList({ rejected }: { readonly rejected: readonly ListedResponse[] }) {
  if (rejected.length === 0) return null;
  return (
    <section className="mod" aria-labelledby="rj-title">
      <h3 className="mod-title" id="rj-title">
        Отказы
      </h3>
      <ul className="rows">
        {rejected.slice(0, MIN_PIPELINE_SAMPLE_SIZE).map(({ row, application }) => (
          <li className="row" key={row.id}>
            <div>
              <div className="row-title">{row.role}</div>
              <div className="row-sub">
                {[row.company, longDate(application.stageChangedAt)].filter(Boolean).join(' · ')}
              </div>
            </div>
            <Link
              className="icon-btn"
              to={buildNodePath('o01c', { responseId: row.id })}
              aria-label={`Открыть отклик: ${row.company}`}
            >
              <Icon name="right" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Review({ items }: { readonly items: readonly ListedResponse[] }) {
  const sent = items.filter((item) => item.application.stage !== 'saved');
  const rejected = sent.filter((item) => item.application.stage === 'rejected');
  const count = sent.length;
  const enough = count >= MIN_PIPELINE_SAMPLE_SIZE;
  return (
    <div className="page two" data-b640-node="o07" data-b640-section="responses">
      <div className="col">
        <section className="lead" aria-labelledby="md-title">
          <div className="lead-head">
            <h2 className="lead-title is-long" id="md-title">
              {enough
                ? `${rejected.length} ${pluralRu(rejected.length, ['отказ', 'отказа', 'отказов'])} на ${count} ${pluralRu(count, FORMS)}`
                : `Мало данных для вывода: ${count} ${pluralRu(count, FORMS)}`}
            </h2>
            <InfoTip
              label="Откуда числа"
              text={`Ваши отправленные отклики. Порог для выводов — ${MIN_PIPELINE_SAMPLE_SIZE} откликов, как в сводке воронки.`}
            />
          </div>
          {enough ? null : <DataMeter count={count} />}
          <div className="actions">
            <Link className="btn is-primary" to={buildNodePath('s07')}>
              <Icon name="vacancies" />
              Посмотреть вакансии
            </Link>
          </div>
        </section>
        <RejectedList rejected={rejected} />
      </div>
      <div className="col" />
    </div>
  );
}

/**
 * «Разбор отказов» (O7). Пока показывает объём данных и сами отказы: выводы
 * «чего не хватило» и рекомендации подключает механика разбора (B679).
 */
export function ReviewScreen() {
  const source = useListedResponses();
  return (
    <LoadGate nodeCode="o07" source={source}>
      {(items) => <Review items={items} />}
    </LoadGate>
  );
}
