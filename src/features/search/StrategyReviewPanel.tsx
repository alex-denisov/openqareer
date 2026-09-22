import type { CareerCommand } from '../coach/coachApi';
import { EyeSlash } from '@phosphor-icons/react';
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
  const measuredSignals = review.signals.filter((signal) => signal.state !== 'untracked');
  const hasFiredSignal = measuredSignals.some((signal) => signal.state === 'fired');

  return (
    <section className="career-strategy-review" aria-labelledby="career-strategy-review-title">
      <header>
        <h3 id="career-strategy-review-title">Что менять, если не работает</h3>
        <span className="career-cabinet-tag">по одному изменению за раз</span>
      </header>
      {hasFiredSignal ? <ChangeOrderLine /> : null}
      <SignalList signals={measuredSignals} />
      <UntrackedBlock />
      {strategy && barrier.delivered.value > 0 ? <BarrierLine barrier={barrier} /> : null}
    </section>
  );
}

function ChangeOrderLine() {
  return (
    <p className="career-home-empty">
      От дешёвого к дорогому: {CHANGE_ORDER.join(' → ')}. Два изменения сразу — не поймёте, что
      сработало.
    </p>
  );
}

function UntrackedBlock() {
  return (
    <div className="career-strategy-untracked">
      <EyeSlash size={16} aria-hidden="true" />
      <div>
        <strong>Чего мы не видим</strong>
        <p>
          Площадки не сообщают просмотры, ответы и интервью. Ориентир: 2–3 недели откликов без
          ответов — проверьте письмо и скрининговые ответы; ответы есть, интервью нет — откройте «К
          интервью».
        </p>
      </div>
    </div>
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
      {barrier.met ? 'Порог для смены роли пройден' : 'Менять роль рано'}: {barrier.days.value} из{' '}
      {barrier.days.total} {barrier.days.basis}, {barrier.delivered.value} из{' '}
      {barrier.delivered.total} {barrier.delivered.basis}. {barrier.loses}
    </p>
  );
}
