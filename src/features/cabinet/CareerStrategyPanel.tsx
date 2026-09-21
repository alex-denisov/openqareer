import type { CareerStrategy } from '../../../shared/careerStrategy';
import { describeStrategy } from './careerStrategyView';

/**
 * «Стратегия» — выбранная роль, её версия и то, на чём она стоит (B180, срез 2).
 *
 * Панель ничего не вычисляет: каждую строку собирает `careerStrategyView.ts`,
 * покрытый тестами построчно. Здесь важно другое — что кандидат видит и
 * версию, и причину смены, и что говорил пул **в момент выбора**, а не сейчас.
 */
export function CareerStrategyPanel({
  strategy,
  loading = false,
  failed = false,
}: {
  readonly strategy: CareerStrategy | null;
  readonly loading?: boolean;
  readonly failed?: boolean;
}) {
  return (
    <section className="career-home-panel career-strategy" aria-labelledby="career-strategy-title">
      <header>
        <h3 id="career-strategy-title">Роль в поиске</h3>
        <span className="career-cabinet-tag">выбрана для поиска</span>
      </header>
      <StrategyBody strategy={strategy} loading={loading} failed={failed} />
    </section>
  );
}

function StrategyBody({
  strategy,
  loading,
  failed,
}: {
  readonly strategy: CareerStrategy | null;
  readonly loading: boolean;
  readonly failed: boolean;
}) {
  // Недоступный маршрут и «ещё не выбирал» — разные факты, и путать их нельзя.
  if (failed) {
    return <p className="career-home-empty">Стратегию не удалось прочитать — обновите страницу.</p>;
  }
  if (loading) return <p className="career-home-empty">Читаем выбранную роль…</p>;
  if (!strategy) {
    return (
      <p className="career-home-empty">
        Роль не выбрана. Выберите выше, и подбор пойдёт по ней.
      </p>
    );
  }

  const view = describeStrategy(strategy);
  return (
    <>
      <p className="career-strategy-role">
        <strong>{view.title}</strong> <span className="career-cabinet-tag">{view.versionLine}</span>
      </p>
      <small>{view.originLine}</small>
      <small>{view.confirmationLine}</small>
      <small>{view.constraintsLine}</small>
      {view.reasonLine ? <small>{view.reasonLine}</small> : null}
      {view.history.length ? (
        <details className="career-strategy-history">
          <summary>Прежние роли ({view.history.length})</summary>
          <ol>
            {view.history.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        </details>
      ) : null}
    </>
  );
}
