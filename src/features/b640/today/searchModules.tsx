import { Button, Icon, Link } from '../kit';
import { buildNodePath } from '../routes';
import type { TodayRead } from '../../today/useToday';
import { ActionLink, BlockError, BlockSkeleton, LeadActions } from './parts';
import { applicationsSummary, queueAction, type TodayAction } from './todayModel';

const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const VACANCIES_ACTION = {
  label: 'Смотреть вакансии',
  icon: 'search',
  path: buildNodePath('s07'),
} as const;

function actions(today: TodayRead): readonly TodayAction[] {
  return (today.snapshot?.queue ?? []).map(queueAction);
}

function TodayReadFallback({ today }: { readonly today: TodayRead }) {
  if (today.failed) {
    return (
      <BlockError
        text="Не удалось загрузить дела на сегодня."
        onRetry={() => void today.refresh()}
      />
    );
  }
  return <BlockSkeleton label="Загружаем дела на сегодня" />;
}

/** Главное дело дня при «Ищу работу»: первая строка очереди. */
export function NextActionModule({
  today,
  lead,
}: {
  readonly today: TodayRead;
  readonly lead: boolean;
}) {
  if (!today.snapshot) return <TodayReadFallback today={today} />;
  const [first] = actions(today);
  if (!first) {
    return (
      <section className="lead" aria-labelledby="today-next">
        <h2 className="lead-title" id="today-next">
          На сегодня дел нет
        </h2>
        {lead ? (
          <LeadActions primary={VACANCIES_ACTION} />
        ) : (
          <LeadActions>
            <ActionLink action={VACANCIES_ACTION} />
          </LeadActions>
        )}
      </section>
    );
  }
  return (
    <section className="lead" aria-labelledby="today-next">
      <h2 className="lead-title" id="today-next">
        {first.title}
      </h2>
      {first.sub ? <p className="lead-sub">{first.sub}</p> : null}
      {lead ? (
        <LeadActions primary={first} />
      ) : (
        <LeadActions>
          <ActionLink action={first} />
        </LeadActions>
      )}
    </section>
  );
}

function ActionRow({ action }: { readonly action: TodayAction }) {
  return (
    <li className="row ev-row">
      <div>
        <div className="row-title">{action.title}</div>
        {action.sub ? <div className="row-sub">{action.sub}</div> : null}
      </div>
      <Link className="btn ev-act" to={action.path} aria-label={action.label}>
        <Icon name={action.icon} />
        <span className="ev-lbl">
          <span className="ev-full">{action.label}</span>
          <span className="ev-short" aria-hidden="true">
            {action.shortLabel}
          </span>
        </span>
      </Link>
    </li>
  );
}

/** «Ещё N дел»: остальные строки очереди, догрузка — «Показать ещё». */
export function MoreActionsModule({ today }: { readonly today: TodayRead }) {
  const rest = actions(today).slice(1);
  if (!today.snapshot) return null;
  const total = Math.max(today.snapshot.queueTotal ?? 0, today.snapshot.queue.length);
  const left = total - today.snapshot.queue.length;
  if (rest.length === 0 && left <= 0) return null;
  return (
    <section className="mod" aria-labelledby="today-more">
      <h3 className="mod-title" id="today-more">
        {`Ещё дел: ${total - 1}`}
      </h3>
      <ul className="rows exp-rows">
        {rest.map((action, index) => (
          <ActionRow action={action} key={`${action.path}-${index}`} />
        ))}
      </ul>
      {left > 0 ? (
        <div className="actions">
          <Button
            variant="quiet"
            icon="down"
            busy={today.queueRemainderLoading}
            onClick={() => void today.loadQueueRemainder()}
          >
            {`Показать ещё ${Math.min(20, left)}`}
          </Button>
        </div>
      ) : null}
      {today.queueRemainderFailed ? (
        <BlockError
          text="Не удалось загрузить остальные дела."
          onRetry={() => void today.loadQueueRemainder()}
        />
      ) : null}
    </section>
  );
}

/** Отклики вне активного поиска: сколько идёт и что ближайшее. */
export function ApplicationsModule({ today }: { readonly today: TodayRead }) {
  const snapshot = today.snapshot;
  const summary = snapshot
    ? applicationsSummary(snapshot.funnel, snapshot.digest.nextInterview, TIME_ZONE)
    : null;
  if (!summary) return null;
  return (
    <section className="mod is-ctx" aria-labelledby="today-responses">
      <h3 className="mod-title" id="today-responses">
        {summary.title}
      </h3>
      {summary.text ? <p className="mod-text">{summary.text}</p> : null}
      <Link className="row-act" to={buildNodePath('o01')}>
        Открыть «Отклики»
      </Link>
    </section>
  );
}

export function ProfileQuestionModule({ title }: { readonly title: string }) {
  return (
    <section className="mod is-quiet" aria-labelledby="today-question">
      <h3 className="mod-title" id="today-question">
        {title}
      </h3>
      <div className="actions">
        <Link className="btn" to={buildNodePath('p09')}>
          <Icon name="target" />
          Уточнить профиль
        </Link>
      </div>
    </section>
  );
}
