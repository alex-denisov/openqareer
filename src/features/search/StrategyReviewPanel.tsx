import type { CareerCommand } from '../coach/coachApi';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { CareerStrategy } from '../../../shared/careerStrategy';
import {
  CHANGE_ORDER,
  reviewStrategy,
  roleChangeBarrier,
  type RoleChangeBarrier,
  type StrategySignal,
} from '../../../shared/strategyReview';

/**
 * «Когда пересматривать стратегию» — сигналы по запущенной кампании
 * (B180, срез 4).
 *
 * Панель не советует «откликнуться ещё сто раз»: это прямо запрещено — объём
 * не лечит ни один из сигналов. Она называет наблюдение, его минимум и то, что
 * менять, в порядке от дешёвого к дорогому. Величины, которых продукт не
 * измеряет, названы неотслеживаемыми, а не показаны нулём.
 */
export function StrategyReviewPanel({
  strategy,
  pool,
  commands,
  now,
}: {
  readonly strategy: CareerStrategy | null;
  readonly pool: readonly MatchedVacancyItem[];
  readonly commands: readonly CareerCommand[];
  readonly now: string;
}) {
  const decidedAt = strategy?.current.decidedAt ?? null;
  const review = reviewStrategy({
    strategyDecidedAt: decidedAt,
    commands: commands.map((command) => ({
      status: command.status,
      deliveredAt: command.execution?.updatedAt ?? null,
    })),
    pool: {
      size: pool.length,
      oldestObservedAt: observation(pool, 'oldest'),
      newestObservedAt: observation(pool, 'newest'),
    },
    now,
  });
  const barrier = roleChangeBarrier({
    strategyDecidedAt: decidedAt,
    // Отклик засчитывается только доставленный: расписка, а не намерение.
    delivered: commands.filter((command) => command.status === 'completed_with_receipt').length,
    now,
  });

  return (
    <section className="career-strategy-review" aria-labelledby="career-strategy-review-title">
      <header>
        <h3 id="career-strategy-review-title">Когда менять стратегию</h3>
        <span className="career-cabinet-tag">по одной переменной за раз</span>
      </header>
      <ChangeOrderLine />
      <SignalList signals={review.signals} />
      {strategy ? <BarrierLine barrier={barrier} /> : null}
    </section>
  );
}

function ChangeOrderLine() {
  return (
    <p className="career-home-empty">
      Порядок изменений — от дешёвого и быстро измеримого к дорогому:{' '}
      {CHANGE_ORDER.join(' → ')}. Две переменные сразу делают результат
      неинтерпретируемым.
    </p>
  );
}

/** Сработавшее впереди, неотслеживаемое — в конце: порядок это и есть смысл. */
function SignalList({ signals }: { readonly signals: readonly StrategySignal[] }) {
  return (
    <ul className="career-signal-list">
      {[...signals]
        .sort((left, right) => rank(left) - rank(right))
        .map((item) => (
          <SignalRow key={item.id} signal={item} />
        ))}
    </ul>
  );
}


function rank(signal: StrategySignal): number {
  const order = { fired: 0, 'not-enough-data': 1, quiet: 2, untracked: 3 } as const;
  return order[signal.state];
}

function SignalRow({ signal }: { readonly signal: StrategySignal }) {
  return (
    <li className={`is-${signal.state}`}>
      <strong>{signal.title}</strong>
      {signal.measure ? (
        <small>
          {signal.measure.value} из {signal.measure.total} — {signal.measure.basis}
        </small>
      ) : null}
      <small>{signal.note}</small>
      {signal.state === 'fired' && signal.whatToChange.length ? (
        <small>Менять: {signal.whatToChange.join(' → ')}</small>
      ) : null}
    </li>
  );
}

function observation(
  pool: readonly MatchedVacancyItem[],
  edge: 'oldest' | 'newest',
): string | null {
  const times = pool
    .map((item) => Date.parse(item.cluster.firstObservedAt))
    .filter((time) => Number.isFinite(time));
  if (!times.length) return null;
  return new Date(edge === 'oldest' ? Math.min(...times) : Math.max(...times)).toISOString();
}

/**
 * Барьер смены роли числами со знаменателями.
 *
 * Он показывается, а не запрещает: решение о своей роли принимает кандидат, а
 * продукт обязан назвать цену — это разные вещи.
 */
function BarrierLine({ barrier }: { readonly barrier: RoleChangeBarrier }) {
  return (
    <p className="career-home-empty">
      Смена роли: {barrier.days.value} из {barrier.days.total} {barrier.days.basis},{' '}
      {barrier.delivered.value} из {barrier.delivered.total} {barrier.delivered.basis} —{' '}
      {barrier.met ? 'барьер взят' : 'барьер не взят'}. {barrier.loses}
    </p>
  );
}
