import { useState, type ReactNode } from 'react';
import { Info } from '@phosphor-icons/react';
import { pluralRu } from '../../../shared/pluralRu';
import { formatDayMonth } from './responseCardFace';
import type { ApplicationListQuery, ApplicationView } from './applicationsApi';
import { computePipelineAnalytics, MIN_PIPELINE_SAMPLE_SIZE } from './pipelineAnalytics';
import { humanSourceLabel } from './sourceLabels';
import './responses-channel-performance.css';

type ChannelSource = ReturnType<typeof computePipelineAnalytics>['sources'][number];

interface ResponsesChannelPerformanceProps {
  readonly applications: readonly ApplicationView[];
  readonly query: ApplicationListQuery;
  /** Stage analytics, opened by «Пояснение» — mockup 5 keeps only the (i) in the header. */
  readonly explanation?: ReactNode;
  readonly initiallyExplained?: boolean;
}

export function ResponsesChannelPerformance({
  applications,
  query,
  explanation,
  initiallyExplained = false,
}: ResponsesChannelPerformanceProps) {
  const [explained, setExplained] = useState(initiallyExplained);
  const sources = computePipelineAnalytics(applications).sources;
  return (
    <section
      id="career-responses-channel-performance"
      className="career-responses-section career-responses-channel-performance"
      aria-labelledby="responses-channel-title"
    >
      <header className="career-responses-section-head">
        <h2 id="responses-channel-title">Результативность по каналам</h2>
        {explanation ? (
          <button
            type="button"
            className="career-responses-section-icon-btn"
            aria-label="Пояснение"
            aria-expanded={explained}
            onClick={() => setExplained((open) => !open)}
          >
            <Info size={18} aria-hidden="true" />
          </button>
        ) : null}
      </header>
      {sources.length === 0 ? (
        <p role="status">За выбранный период нет откликов с указанным источником.</p>
      ) : (
        <ChannelPerformanceData sources={sources} />
      )}
      <ChannelNote applications={applications} query={query} sourceCount={sources.length} />
      {explained ? explanation : null}
    </section>
  );
}

function ChannelPerformanceData({ sources }: { readonly sources: readonly ChannelSource[] }) {
  return (
    <>
      <ChannelPerformanceTable sources={sources} />
      <ChannelPerformanceCards sources={sources} />
    </>
  );
}

function share(part: number, total: number): ReactNode {
  const percent =
    total > 0
      ? ((part / total) * 100).toLocaleString('ru-RU', {
          maximumFractionDigits: 1,
          minimumFractionDigits: 1,
        })
      : '0,0';
  return (
    <>
      {percent} %{' '}
      <span className="career-responses-channel-performance__n">
        ({part.toLocaleString('ru-RU')})
      </span>
    </>
  );
}

function ChannelRow({
  label,
  total,
  responded,
  interview,
}: {
  readonly label: string;
  readonly total: number;
  readonly responded: number;
  readonly interview: number;
}) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td className="career-numeric">{total.toLocaleString('ru-RU')}</td>
      <td className="career-numeric">{share(responded, total)}</td>
      <td className="career-numeric">{share(interview, total)}</td>
    </tr>
  );
}

function ChannelPerformanceTable({ sources }: { readonly sources: readonly ChannelSource[] }) {
  const sum = (key: 'total' | 'responded' | 'interview') =>
    sources.reduce((acc, source) => acc + source[key], 0);
  return (
    <div className="career-responses-channel-performance__desktop">
      <div className="career-responses-channel-performance__table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Канал</th>
              <th scope="col">Откликов</th>
              <th scope="col">Ответили</th>
              <th scope="col">Интервью</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((source) => (
              <ChannelRow
                key={source.source}
                label={humanSourceLabel(source.source)}
                total={source.total}
                responded={source.responded}
                interview={source.interview}
              />
            ))}
            <ChannelRow
              label="Всего"
              total={sum('total')}
              responded={sum('responded')}
              interview={sum('interview')}
            />
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Mockup 5 note: sample, period end and the caveat in one boxed line. */
function ChannelNote({
  applications,
  query,
  sourceCount,
}: {
  readonly applications: readonly ApplicationView[];
  readonly query: ApplicationListQuery;
  readonly sourceCount: number;
}) {
  if (applications.length === 0) return null;
  const sample = `по ${applications.length.toLocaleString('ru-RU')} ${pluralWord(applications.length)} ${formatPeriod(query, applications)}`;
  const tail =
    applications.length < MIN_PIPELINE_SAMPLE_SIZE
      ? 'Меньше 20 откликов: узкие места не определены.'
      : sourceCount === 1
        ? 'В выборке один канал: сравнить каналы пока нельзя.'
        : 'Это наблюдение, не обещание результата: роли и компании в каналах разные.';
  return (
    <p className="career-responses-channel-performance__note" role="note">
      <Info size={16} aria-hidden="true" />
      <span>
        Разница между каналами: {sample}. {tail}
      </span>
    </p>
  );
}

function pluralWord(count: number): string {
  return pluralRu(count, ['отклику', 'откликам', 'откликам']).replace(/^\S+\s/u, '');
}

function ChannelPerformanceCards({ sources }: { readonly sources: readonly ChannelSource[] }) {
  return (
    <ul className="career-responses-channel-performance__mobile">
      {sources.map((source) => (
        <li key={source.source}>
          <h3>{humanSourceLabel(source.source)}</h3>
          <dl>
            <div>
              <dt>Отклики, n</dt>
              <dd className="career-numeric">{source.total.toLocaleString('ru-RU')}</dd>
            </div>
            <div>
              <dt>Ответили, n</dt>
              <dd className="career-numeric">{source.responded.toLocaleString('ru-RU')}</dd>
            </div>
            <div>
              <dt>Интервью, n</dt>
              <dd className="career-numeric">{source.interview.toLocaleString('ru-RU')}</dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  );
}

function formatPeriod(
  query: ApplicationListQuery,
  applications: readonly ApplicationView[],
): string {
  const last =
    query.to ??
    applications
      .map((application) => application.createdAt)
      .sort()
      .at(-1);
  const until = formatDayMonth(last);
  return until ? `до ${until}` : 'за выбранный период';
}
