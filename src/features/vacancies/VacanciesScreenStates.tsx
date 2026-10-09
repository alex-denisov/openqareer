import { MagnifyingGlass, Warning } from '@phosphor-icons/react';

export function VacanciesSkeletonStack() {
  return (
    <div className="skeleton-stack" aria-live="polite" aria-busy="true">
      <p className="list-hint">Загружаем подборку по кампании…</p>
      <div className="skeleton-row" />
      <div className="skeleton-row" />
      <div className="skeleton-row" />
      <div className="skeleton-row" />
    </div>
  );
}

export function VacanciesErrorState({
  failureSourceLabel,
  onRetry,
}: {
  readonly failureSourceLabel?: string;
  readonly onRetry?: () => void;
}) {
  return (
    <div className="state-panel is-error vacancies-state" role="alert">
      <span className="state-icon" aria-hidden="true">
        <Warning size={20} />
      </span>
      <h3>Не удалось загрузить подборку</h3>
      <p>
        Не удалось загрузить общий пул вакансий.{' '}
        {failureSourceLabel ?? 'Площадка hh.ru не ответила.'} Роль и география сохранены.
      </p>
      {onRetry ? (
        <button type="button" className="btn btn-secondary vacancies-btn" onClick={onRetry}>
          Повторить
        </button>
      ) : null}
    </div>
  );
}

export function VacanciesEmptyPoolState({
  primaryRole,
  onRetry,
}: {
  readonly primaryRole?: string;
  readonly onRetry?: () => void;
}) {
  return (
    <div className="state-panel vacancies-state">
      <span className="state-icon" aria-hidden="true">
        <MagnifyingGlass size={20} />
      </span>
      <h3>
        {primaryRole ? `По роли ${primaryRole} пока нет вакансий` : 'Для подбора не выбрана роль'}
      </h3>
      <p>
        Пустая выдача сама по себе ничего не говорит о рынке. Можно добавить смежную роль, расширить
        регионы или включить удалённый поиск.
      </p>
      {onRetry ? (
        <button type="button" className="btn btn-secondary vacancies-btn" onClick={onRetry}>
          Обновить подбор
        </button>
      ) : null}
    </div>
  );
}

export function VacanciesEmptyFilterState({
  totalCount,
  onReset,
}: {
  readonly totalCount: number;
  readonly onReset: () => void;
}) {
  return (
    <div className="state-panel vacancies-filter-empty">
      <span className="state-icon" aria-hidden="true">
        <MagnifyingGlass size={20} />
      </span>
      <h3>По этим фильтрам ничего нет</h3>
      <p>
        В пуле {totalCount} вакансий — под текущие фильтры не подошла ни одна. Ослабьте фильтры или
        сохраните запрос, чтобы получать новые совпадения по расписанию.
      </p>
      <button
        type="button"
        className="btn btn-secondary vacancies-btn vacancies-reset"
        onClick={onReset}
      >
        Сбросить фильтры
      </button>
    </div>
  );
}
