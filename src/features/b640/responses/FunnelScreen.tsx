import { useCallback, useMemo, type ReactNode } from 'react';
import { listApplicationsPool, type ApplicationView } from '../../applications/applicationsApi';
import { MIN_PIPELINE_SAMPLE_SIZE } from '../../applications/pipelineAnalytics';
import { Button, Icon, InfoTip, Link, StatusLine } from '../kit';
import { buildNodePath } from '../routes';
import { useAsync } from './data/useAsync';
import { funnelSummary, markAuto, type FunnelSummary, type ListedResponse } from './model/responseList';
import { useAutoApplicationIds } from './data/responseSummaryApi';
import { buildResponseRow, pluralRu } from './model/responseRow';

async function loadResponses(signal: AbortSignal): Promise<readonly ApplicationView[]> {
  return (await listApplicationsPool({}, signal)).items;
}

/** Отклики раздела с готовыми строками: общая загрузка для «Воронки» и «Разбора отказов». */
export function useListedResponses() {
  const load = useCallback((signal: AbortSignal) => loadResponses(signal), []);
  const { state, reload } = useAsync(load, 'Отклики не загрузились.');
  const autoIds = useAutoApplicationIds();
  const items = useMemo<readonly ListedResponse[] | null>(() => {
    if (!state.data) return null;
    const now = new Date();
    const rows = state.data.map((application) => ({ application, row: buildResponseRow(application, now) }));
    return markAuto(rows, autoIds);
  }, [state.data, autoIds]);
  return { state, reload, items };
}

interface LoadGateProps {
  readonly nodeCode: string;
  readonly source: ReturnType<typeof useListedResponses>;
  readonly children: (items: readonly ListedResponse[]) => ReactNode;
}

/** Ожидание и ошибка загрузки на месте экрана. */
export function LoadGate({ nodeCode, source, children }: LoadGateProps) {
  const { state, reload, items } = source;
  if (items) return <>{children(items)}</>;
  return (
    <div className="page two" data-b640-node={nodeCode} data-b640-section="responses">
      {state.status === 'error' ? (
        <StatusLine
          state="err"
          text={state.error}
          action={
            <Button size="sm" onClick={reload}>
              Повторить
            </Button>
          }
        />
      ) : (
        <p className="ls-state" role="status">
          Загружаем отклики…
        </p>
      )}
    </div>
  );
}

function funnelTitle(summary: FunnelSummary): string {
  if (summary.sent === 0) return 'Отправленных откликов пока нет';
  if (summary.silent === 0) return 'Все компании ответили';
  return `${summary.silent} ${pluralRu(summary.silent, ['компания', 'компании', 'компаний'])} пока ${pluralRu(summary.silent, ['молчит', 'молчат', 'молчат'])}`;
}

function RemindBlock({ remind }: { readonly remind: readonly ListedResponse[] }) {
  if (remind.length === 0) return null;
  return (
    <>
      <div className="actions">
        <Link className="btn is-primary" to={buildNodePath('o01c', { responseId: remind[0].row.id })}>
          <Icon name="send" />
          {`Напомнить ${remind.length} ${pluralRu(remind.length, ['компании', 'компаниям', 'компаниям'])}`}
        </Link>
      </div>
      {remind.length > 1 ? (
        <details className="fv-one">
          <summary className="row-act">Напомнить по одному</summary>
          <ul className="rows">
            {remind.slice(0, MIN_PIPELINE_SAMPLE_SIZE).map(({ row }) => (
              <li className="row" key={row.id}>
                <div className="row-title">{row.company}</div>
                <Link className="row-act" to={buildNodePath('o01c', { responseId: row.id })}>
                  Напомнить
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}

function SourcesTable({ summary }: { readonly summary: FunnelSummary }) {
  if (summary.sources.length === 0) return null;
  return (
    <section className="mod" aria-labelledby="fv-src">
      <h3 className="mod-title" id="fv-src">
        По площадкам
      </h3>
      <table className="fv-table">
        <caption className="vh">Отклики по площадкам</caption>
        <thead>
          <tr>
            <th scope="col">Площадка</th>
            <th scope="col">Откликов</th>
            <th scope="col">Ответили</th>
            <th scope="col">Интервью</th>
          </tr>
        </thead>
        <tbody>
          {summary.sources.map((source) => (
            <tr key={source.source}>
              <th scope="row">{source.sourceLabel}</th>
              <td className="num">{source.total}</td>
              <td className="num">{source.responded}</td>
              <td className="num">{source.interview}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function FunnelNumbers({ summary }: { readonly summary: FunnelSummary }) {
  if (summary.sent === 0) {
    return (
      <div className="actions">
        <Link className="btn is-primary" to={buildNodePath('s07')}>
          <Icon name="search" />
          Подобрать вакансии
        </Link>
      </div>
    );
  }
  return (
    <p className="fv-mini">
      <b className="num">{summary.sent}</b> отправлено · <b className="num">{summary.responded}</b>{' '}
      ответили · <b className="num">{summary.interview}</b> интервью ·{' '}
      <b className="num">{summary.offer}</b> {pluralRu(summary.offer, ['оффер', 'оффера', 'офферов'])}
      {summary.auto > 0 ? (
        <>
          {' '}
          · из них <b className="num">{summary.auto}</b> {pluralRu(summary.auto, ['автоотклик', 'автоотклика', 'автооткликов'])}
        </>
      ) : null}
    </p>
  );
}

function Funnel({ items }: { readonly items: readonly ListedResponse[] }) {
  const summary = funnelSummary(items);
  return (
    <div className="page two" data-b640-node="o01e" data-b640-section="responses">
      <div className="col">
        <section className="lead" aria-labelledby="fv-title">
          <div className="lead-head">
            <h2 className="lead-title is-long" id="fv-title">
              {funnelTitle(summary)}
            </h2>
            {summary.since ? (
              <InfoTip
                label="Источник"
                text={`Воронка с ${summary.since}. Статусы — по вашим отметкам и подтверждениям площадок.`}
              />
            ) : null}
          </div>
          <FunnelNumbers summary={summary} />
          <RemindBlock remind={summary.remind} />
        </section>
        <SourcesTable summary={summary} />
      </div>
      <div className="col" />
    </div>
  );
}

/** «Воронка» (O1e): сколько отправлено и кто молчит, отклики по площадкам. */
export function FunnelScreen() {
  const source = useListedResponses();
  return (
    <LoadGate nodeCode="o01e" source={source}>
      {(items) => <Funnel items={items} />}
    </LoadGate>
  );
}
