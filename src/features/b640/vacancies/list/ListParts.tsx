import type { MatchedPool } from '../../../vacancies/useMatchedPool';
import { Icon, InfoTip, Link } from '../../kit';
import { buildNodePath } from '../../routes';
import type { VacancyLinks } from '../vacancyLinks';
import { footOf } from './sortModel';

export const FIT_TIP = 'Совпадение требований вакансии с подтверждённым опытом профиля.';

/** Сбой чтения подборки или отметок: строка с «Повторить» на месте, введённое не теряется. */
export function LoadErrors({ pool, links }: { pool: MatchedPool; links: VacancyLinks }) {
  return (
    <>
      {pool.failed ? (
        <div className="vl-err" role="alert">
          <Icon name="warn" />
          <span>Подборка не обновилась</span>
          <button className="row-act" type="button" onClick={() => pool.refresh?.()}>
            <Icon name="refresh" />
            Повторить
          </button>
        </div>
      ) : null}
      {links.failed ? (
        <div className="vl-err" role="alert">
          <Icon name="warn" />
          <span>Отметки «сохранено» и «откликнулся» не загрузились</span>
          <button className="row-act" type="button" onClick={links.reload}>
            <Icon name="refresh" />
            Повторить
          </button>
        </div>
      ) : null}
    </>
  );
}

export function LoadingLine() {
  return (
    <p className="ls-state" role="status">
      Загружаем подборку…
    </p>
  );
}

export function CountTitle({ count, word, tip }: { count: number; word: string; tip?: boolean }) {
  return (
    <h2 id="list-title" className="vl-count">
      <span className="num">{count}</span>
      <span className="vl-word"> {word}</span>
      {tip ? <InfoTip label="Как посчитано" text={FIT_TIP} /> : null}
    </h2>
  );
}

export function MoreFoot({ total, shown, onMore }: { total: number; shown: number; onMore: () => void }) {
  const foot = footOf(total, shown);
  if (!foot) return null;
  return (
    <div className="vl-foot">
      <button className="btn" type="button" onClick={onMore}>
        <Icon name="down" />
        <span>
          Показать ещё {foot.step} · осталось <span className="num">{foot.left}</span>
        </span>
      </button>
    </div>
  );
}

/** Полоса над списком: пустой профиль (p04) или роль не выбрана (s10). */
export function GapStrip({ kind }: { kind: 'profile' | 'role' }) {
  const profile = kind === 'profile';
  return (
    <section className="gap-strip sk-strip" aria-label={profile ? 'Профиль пуст' : 'Роль не выбрана'}>
      <p>{profile ? 'Опыта в профиле нет' : 'Роль поиска не выбрана'}</p>
      <Link className={profile ? 'btn' : 'btn is-primary'} to={buildNodePath(profile ? 'p04' : 's10')}>
        <Icon name={profile ? 'plus' : 'target'} />
        {profile ? 'Добавить опыт' : 'Выбрать роль'}
      </Link>
    </section>
  );
}

export function EmptyByFilters({
  blockers,
  onRemove,
  onReset,
}: {
  blockers: ReadonlyArray<{ readonly kind: string; readonly label: string }>;
  onRemove: (kind: string) => void;
  onReset: () => void;
}) {
  return (
    <div className="vl-empty" role="status">
      <p className="vl-empty-t">По фильтрам ничего</p>
      <div className="vl-empty-a">
        {blockers.map((blocker) => (
          <button key={blocker.kind} className="btn" type="button" onClick={() => onRemove(blocker.kind)}>
            <Icon name="close" />
            Снять: {blocker.label}
          </button>
        ))}
        <button className="btn is-primary" type="button" onClick={onReset}>
          <Icon name="close" />
          Снять все фильтры
        </button>
      </div>
    </div>
  );
}
