import type { ApplicationListQuery, ApplicationView } from './applicationsApi';
import { computePipelineAnalytics } from './pipelineAnalytics';
import { humanSourceLabel } from './sourceLabels';
import './responses-channel-performance.css';

type ChannelSource = ReturnType<typeof computePipelineAnalytics>['sources'][number];

export function ResponsesChannelPerformance({
  applications,
  query,
}: {
  readonly applications: readonly ApplicationView[];
  readonly query: ApplicationListQuery;
}) {
  const sources = computePipelineAnalytics(applications).sources;
  const period = formatPeriod(query, applications);
  return (
    <section
      id="career-responses-channel-performance"
      className="career-responses-channel-performance"
      aria-labelledby="responses-channel-title"
    >
      <header>
        <div>
          <h2 id="responses-channel-title">Результативность по каналам</h2>
          <p>
            Ваши отклики · выборка {applications.length.toLocaleString('ru-RU')} · {period}
          </p>
        </div>
      </header>
      {sources.length === 0 ? (
        <p role="status">За выбранный период нет откликов с указанным источником.</p>
      ) : (
        <ChannelPerformanceData sources={sources} />
      )}
      {sources.length === 1 ? <SingleChannelNote /> : null}
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

function ChannelPerformanceTable({ sources }: { readonly sources: readonly ChannelSource[] }) {
  return (
    <div className="career-responses-channel-performance__desktop">
      <div className="career-responses-channel-performance__table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Канал</th>
              <th scope="col">Отклики, n</th>
              <th scope="col">Ответили, n</th>
              <th scope="col">Интервью, n</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((source) => (
              <tr key={source.source}>
                <th scope="row">{humanSourceLabel(source.source)}</th>
                <td className="career-numeric">{source.total.toLocaleString('ru-RU')}</td>
                <td className="career-numeric">{source.responded.toLocaleString('ru-RU')}</td>
                <td className="career-numeric">{source.interview.toLocaleString('ru-RU')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
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

function SingleChannelNote() {
  return (
    <p className="career-responses-channel-performance__note" role="note">
      В выборке указан один канал; сравнить каналы пока нельзя.
    </p>
  );
}

function formatPeriod(
  query: ApplicationListQuery,
  applications: readonly ApplicationView[],
): string {
  if (query.from && query.to) return `${query.from} — ${query.to}`;
  const dates = applications
    .map((application) => application.createdAt.slice(0, 10))
    .filter(Boolean)
    .sort();
  if (dates.length === 0) return 'период не определён';
  return dates[0] === dates.at(-1) ? dates[0] : `${dates[0]} — ${dates.at(-1)}`;
}
