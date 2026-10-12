import { pluralRu, pluralWordRu } from '../../../shared/pluralRu';
import type { CareerCabinetView } from '../cabinet/cabinetViews';
import type { TodayDigest, TodaySinceLastVisit } from './todayApi';
import { buildReturningDigestItems, digestBasis } from './todayFormat';

export function TodayReturnBanner({
  sinceLastVisit,
  digest,
  onNavigate,
}: {
  readonly sinceLastVisit: TodaySinceLastVisit;
  readonly digest: TodayDigest;
  readonly onNavigate?: (view: CareerCabinetView) => void;
}) {
  const newVacanciesCount = sinceLastVisit.newVacanciesCount ?? digest.newVacancies;
  const applicationsWaitingOver7Days =
    sinceLastVisit.applicationsWaitingOver7Days ?? digest.applicationsWaitingOver7Days ?? 0;
  const nearestInterview = sinceLastVisit.nearestInterview ?? digest.nextInterview;
  const items = buildReturningDigestItems({
    since: sinceLastVisit.since,
    newVacanciesCount,
    applicationsWaitingOver7Days,
    nearestInterview,
  });
  if (items.length === 0) return null;
  return (
    <div className="career-today-return-banner" data-testid="career-today-return-banner">
      <span className="career-today-return-prefix">С прошлого визита: </span>
      {items.map((item, index) => (
        <span key={item.id} className="career-today-return-segment">
          {index > 0 ? (
            <span className="career-today-return-separator" aria-hidden="true">
              {' · '}
            </span>
          ) : null}
          <button
            type="button"
            className="career-today-return-link"
            data-testid={`since-visit-${item.id}`}
            onClick={() => onNavigate?.(item.targetView)}
          >
            {item.label}
          </button>
        </span>
      ))}
    </div>
  );
}

export function TodayDigestRow({ digest }: { readonly digest: TodayDigest }) {
  return (
    <div className="career-today-digest">
      <DigestCard
        value={digest.newVacancies}
        label={pluralRu(digest.newVacancies, [
          'новая релевантная вакансия с прошлого визита',
          'новые релевантные вакансии с прошлого визита',
          'новых релевантных вакансий с прошлого визита',
        ])}
        basis={digestBasis('new', digest)}
      />
      <DigestCard
        value={digest.followUpsDueToday}
        label={pluralWordRu(digest.followUpsDueToday, [
          'напоминание компании на сегодня',
          'напоминания компании на сегодня',
          'напоминаний компании на сегодня',
        ])}
        basis={digestBasis('followUp', digest)}
        attention={digest.followUpsDueToday > 0}
      />
      <DigestCard
        value={digest.followUpsOverdue}
        label={pluralWordRu(digest.followUpsOverdue, [
          'напоминание просрочено',
          'напоминания просрочено',
          'напоминаний просрочено',
        ])}
        basis={null}
        attention={digest.followUpsOverdue > 0}
      />
      <DigestCard
        value={digest.interviewsAhead}
        label={pluralRu(digest.interviewsAhead, [
          'интервью впереди, нужна подготовка',
          'интервью впереди, нужна подготовка',
          'интервью впереди, нужна подготовка',
        ])}
        basis={digestBasis('interview', digest)}
      />
    </div>
  );
}

function DigestCard({
  value,
  label,
  basis,
  attention = false,
}: {
  readonly value: number;
  readonly label: string;
  readonly basis: string | null;
  readonly attention?: boolean;
}) {
  return (
    <div className={`career-today-digest-card${attention ? ' is-attention' : ''}`}>
      <span className="career-today-digest-number">{value}</span>
      <span className="career-today-digest-label">{label}</span>
      {basis ? <span className="career-today-digest-basis">{basis}</span> : null}
    </div>
  );
}
