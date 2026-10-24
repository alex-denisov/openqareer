import type { SeoProviderView, SeoSearchProviders } from '../../../shared/seoSourceSnapshot';

const metric = (value: number | null) => value === null ? 'нет данных' : value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
const timestamp = (value: string) => new Date(value).toLocaleString('ru-RU');

function Provider({ name, source, google }: { name: string; source: SeoProviderView; google: boolean }) {
  const data = source.lastSuccess;
  if (!data) return <p><strong>{name}:</strong> данные API недоступны.
    {source.latestAttempt && <> Последняя попытка: {timestamp(source.latestAttempt.observedAt)}.</>}</p>;
  return <section aria-label={name}>
    <h3>{name}</h3>
    <p className="admin-note">Подготовленный срез API: {timestamp(data.observedAt)}.
      {source.stale && ' Срез устарел; свежего успешного наблюдения нет.'}
      {source.latestAttempt?.status === 'partial' && ' Часть показателей источника недоступна.'}</p>
    {source.latestAttempt?.status === 'unavailable' && <p className="admin-note">Последняя попытка {timestamp(source.latestAttempt.observedAt)} не дала нового среза. Показано предыдущее успешное наблюдение.</p>}
    {data.window ? <p className="admin-note">Период источника: {data.window.from} — {data.window.to}
      {data.window.timezone === 'America/Los_Angeles' ? ' (даты Google, тихоокеанское время).' : ' (даты, возвращённые источником).'}</p>
      : <p className="admin-note">Период источника недоступен.</p>}
    {data.sections.aggregate === 'unavailable' ? <p>Общие показатели недоступны.</p> : google
      ? <p>Клики: {metric(data.metrics.clicks)}. Показы: {metric(data.metrics.impressions)}.
        {' '}CTR: {data.metrics.ctr === null ? 'нет данных' : `${metric(data.metrics.ctr * 100)}%`}.
        {' '}Средняя позиция: {metric(data.metrics.position)}.</p>
      : <p>Страниц в поиске: {metric(data.metrics.indexedPages)}. ИКС: {metric(data.metrics.sqi)}.</p>}
    {data.sections.queries === 'unavailable' ? <p className="admin-note">Популярные запросы недоступны.</p>
      : data.queries.length === 0 ? <p className="admin-note">Источник не вернул популярных запросов.</p>
      : <details><summary>Популярные запросы ({data.queries.length})</summary>
        <ol>{data.queries.map((row, index) => <li key={index}>
          <p><strong>{row.query}</strong><br />Клики: {metric(row.clicks)}. Показы: {metric(row.impressions)}.
            {' '}Позиция: {metric(row.position)}.</p>
        </li>)}</ol></details>}
  </section>;
}

export function AdminSeoSources({ sources }: { sources: SeoSearchProviders }) {
  return <section className="admin-card admin-seo-sources" aria-labelledby="seo-search-title">
    <h2 id="seo-search-title">Поисковые источники</h2>
    <Provider name="Google Search Console" source={sources.google} google />
    <Provider name="Яндекс Вебмастер" source={sources.yandex} google={false} />
    <p className="admin-note">Недоступные показы, клики и позиции не заменены нулями.
      Сводка читает подготовленный файл и не обращается к внешним API при открытии страницы.</p>
  </section>;
}
