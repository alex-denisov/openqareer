import { AdminSeoSources } from './AdminSeoSources';
import { useEffect, useState } from 'react';
import type { SeoGoalSummary } from '../../../shared/seoSummary';
import { getAdminSeoSummary } from './adminApi';

const displayCount = (value: number | null) => value === null ? 'Недоступно' : value.toLocaleString('ru-RU');
const displayDate = (value: string) => new Date(value).toLocaleString('ru-RU');

type State = { status: 'loading' } | { status: 'failed'; message: string } |
  { status: 'ready'; summary: SeoGoalSummary };

export function AdminSeoSummaryData({ summary }: { summary: SeoGoalSummary }) {
  return <>
    <p className="admin-note">Период: {displayDate(summary.period.from)} — {displayDate(summary.period.to)}.
      {' '}Срез получен {displayDate(summary.observedAt)}.</p>
    <section className="admin-card" aria-labelledby="seo-goals-title">
      <h2 id="seo-goals-title">Действия в продукте</h2>
      <p><strong>{displayCount(summary.goals.onboardingCompleted)}</strong> — завершили мастер настройки</p>
      <p><strong>{displayCount(summary.goals.proTrialsStarted)}</strong> — запустили пробную подписку Pro</p>
      <p><strong>{displayCount(summary.goals.applicationsWithCandidateReceipt)}</strong> — отклики с предоставленной квитанцией доставки</p>
      <p className="admin-note">Завершение мастера фиксируется отдельным серверным действием.
        Обычное сохранение ответов не считается завершением. Пробные подписки считаются по сохранённым запускам.</p>
      <p className="admin-note">Квитанцию предоставляет кандидат: ссылка на подтверждение, автоматический ответ или снимок экрана.
        Это не независимая проверка работодателем. Повторная квитанция одного отклика не увеличивает число.</p>
    </section>
    <AdminSeoSources sources={summary.searchProviders} />
    <section className="admin-card" aria-labelledby="seo-method-title">
      <h2 id="seo-method-title">Как читать числа</h2>
      <p className="admin-note">Источник — внутренние серверные записи за выбранный период. Мастер и квитанции учитываются
        с момента включения этих отметок; старые действия не восстановлены задним числом.
        Удалённые кандидаты, синтетические данные и тестовые аккаунты исключены.</p>
      <p className="admin-note">Конверсия из органического поиска недоступна: связи между поисковым переходом и действием
        кандидата пока нет. Все действия продукта нельзя делить на клики из поиска.</p>
    </section>
  </>;
}

export function AdminSeoSummaryView() {
  const [days, setDays] = useState(28);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<State>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    void getAdminSeoSummary(days, controller.signal).then((summary) => {
      if (!controller.signal.aborted) setState({ status: 'ready', summary });
    }, () => {
      if (!controller.signal.aborted) setState({ status: 'failed', message: 'Не удалось получить сводку. Проверьте доступ и повторите запрос.' });
    });
    return () => controller.abort();
  }, [days, revision]);
  return <section aria-labelledby="seo-summary-title" aria-busy={state.status === 'loading'}>
    <div className="admin-head">
      <div><p className="admin-eyebrow">Поиск и продукт</p><h1 id="seo-summary-title">SEO-сводка</h1></div>
      <button type="button" className="admin-btn admin-btn--secondary" disabled={state.status === 'loading'}
        onClick={() => setRevision((value) => value + 1)}>Обновить</button>
    </div>
    <nav className="admin-register-chips" aria-label="Период SEO-сводки">
      {[7, 28, 90].map((value) => <button type="button" key={value} className="admin-btn admin-btn--secondary"
        aria-pressed={days === value} disabled={state.status === 'loading'} onClick={() => setDays(value)}>{value} дней</button>)}
    </nav>
    {state.status === 'loading' && <p className="admin-note" role="status">Получаем серверный срез…</p>}
    {state.status === 'failed' && <div className="admin-error" role="alert"><p>{state.message}</p>
      <button type="button" className="admin-btn admin-btn--secondary" onClick={() => setRevision((value) => value + 1)}>Повторить</button></div>}
    {state.status === 'ready' && <AdminSeoSummaryData summary={state.summary} />}
  </section>;
}
