import { VacancyFitInline } from './VacancyFitSummary';
import { VacancyMoneyCell } from './VacancyMoneyCell';
import { vacancySourceLabels } from '../../../shared/vacancySourceLabel';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { GeoFitDot, LevelFitDot } from './VacancyFitDots';

const VACANCY_LEVEL_LABEL = {
  ic: 'Специалист',
  lead: 'Лид',
  head: 'Head',
  vp: 'VP',
  'c-level': 'C-level',
} as const;

/** Подпись уровня — тот же уровень, с которым сервер сравнивал кандидата. */
export function vacancyLevelLabel(item: MatchedVacancyItem): string {
  const level = item.explanation.vacancyLevel;
  return level ? VACANCY_LEVEL_LABEL[level] : titleLevelLabel(item.cluster.canonicalTitle);
}

function titleLevelLabel(title: string): string {
  return (
    title.match(
      /^(C-level|CEO|CTO|VP|Vice President|Head|Director|Lead|Senior|Staff|Principal|Junior|Руководитель|Директор|Лид|Специалист)\b/iu,
    )?.[0] ?? 'Не указан'
  );
}

function observedDate(item: MatchedVacancyItem): string | undefined {
  const value = item.cluster.sources[0]?.observedAt ?? item.cluster.firstObservedAt;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Europe/Moscow',
  }).format(date);
}

function VacancyScreenRoleCell({
  item,
  applicationArchived,
  alreadyApplied,
}: {
  readonly item: MatchedVacancyItem;
  readonly applicationArchived: boolean;
  readonly alreadyApplied: boolean;
}) {
  const source = vacancySourceLabels(item.cluster.sources)[0] ?? 'Источник неизвестен';
  const date = observedDate(item);
  const applicationStatus = applicationArchived
    ? 'Отклик в архиве'
    : alreadyApplied
      ? 'Отклик отмечен'
      : null;
  return (
    <span className="vacancies-screen-cell vacancies-screen-cell--role" data-label="Роль">
      <span className="vac-title" role="heading" aria-level={3}>
        {item.cluster.canonicalTitle}
      </span>
      <span className="vac-sub">
        {item.cluster.canonicalCompany} · {source}
        {date ? `, ${date}` : ''}
      </span>
      <VacancyFitInline vacancyId={item.cluster.id} view={item.explanation.fitView} />
      {applicationStatus ? (
        <span className={`applied-note${applicationArchived ? ' is-archived' : ''}`}>
          {applicationStatus}
        </span>
      ) : null}
    </span>
  );
}

function VacancyScreenLevelCell({ item }: { readonly item: MatchedVacancyItem }) {
  const fitLabel =
    item.explanation.levelMatch === 'match'
      ? 'совпадает'
      : item.explanation.levelMatch === 'unknown'
        ? 'не указано'
        : 'не совпадает';
  return (
    <span className="vacancies-screen-cell vacancies-screen-cell--level" data-label="Уровень">
      <span>{vacancyLevelLabel(item)}</span>
      <span className="vacancies-screen-fit-status">
        <span aria-hidden="true">
          <LevelFitDot levelMatch={item.explanation.levelMatch} />
        </span>
        <span>{fitLabel}</span>
      </span>
    </span>
  );
}

function VacancyScreenGeoCell({ item }: { readonly item: MatchedVacancyItem }) {
  const fitLabel = item.explanation.outsideGeography ? 'не совпадает' : 'совпадает';
  return (
    <span className="vacancies-screen-cell vacancies-screen-cell--geo" data-label="Гео">
      <span>
        {item.cluster.canonicalLocation ?? (item.cluster.isRemote ? 'Удалённо' : 'Не указано')}
      </span>
      <span className="vacancies-screen-fit-status">
        <span aria-hidden="true">
          <GeoFitDot outsideGeo={item.explanation.outsideGeography} />
        </span>
        <span>{fitLabel}</span>
      </span>
    </span>
  );
}

export function VacancyScreenRowCells({
  item,
  applicationArchived,
  alreadyApplied,
}: {
  readonly item: MatchedVacancyItem;
  readonly applicationArchived: boolean;
  readonly alreadyApplied: boolean;
}) {
  return (
    <>
      <VacancyScreenRoleCell
        item={item}
        applicationArchived={applicationArchived}
        alreadyApplied={alreadyApplied}
      />
      <VacancyScreenLevelCell item={item} />
      <VacancyScreenGeoCell item={item} />
      <VacancyMoneyCell item={item} observedDate={observedDate(item)} />
    </>
  );
}
