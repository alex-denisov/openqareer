import { VacancyFitInline } from './VacancyFitSummary';
import { VacancyMoneyCell } from './VacancyMoneyCell';
import { vacancySourceLabels } from '../../../shared/vacancySourceLabel';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { CheckCircle, MapPin, Question, WarningCircle } from '@phosphor-icons/react';
import { GeoFitDot, LevelFitDot } from './VacancyFitDots';
import { vacancyFormat } from './vacancyScreenCriteria';
import { workFormatLabel } from '../../../shared/vacancyWorkFormat';

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

export function observedDate(item: MatchedVacancyItem): string | undefined {
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
  const formatBlocked = formatGateBlocked(item);
  const outside = Boolean(item.explanation.outsideGeography) || formatBlocked;
  const fitLabel = item.explanation.outsideGeography
    ? 'другой город'
    : formatBlocked
      ? 'формат не подходит'
      : 'совпадает';
  return (
    <span className="vacancies-screen-cell vacancies-screen-cell--geo" data-label="Гео">
      <span>{vacancyGeoLabel(item)}</span>
      <span className="vacancies-screen-fit-status">
        <span aria-hidden="true">
          <GeoFitDot outsideGeo={outside} />
        </span>
        <span>{fitLabel}</span>
      </span>
    </span>
  );
}

/** «Москва, гибрид» — город и формат из одного разбора с фильтром «Формат» (B446-g4). */
export function vacancyGeoLabel(item: MatchedVacancyItem): string {
  const place =
    item.cluster.canonicalLocation ?? (item.cluster.isRemote ? 'Удалённо' : 'Не указано');
  const format = workFormatLabel(vacancyFormat(item));
  if (!format || place.toLocaleLowerCase('ru-RU').includes(format)) return place;
  return `${place}, ${format}`;
}

function formatGateBlocked(item: MatchedVacancyItem): boolean {
  return item.explanation.fitView?.result?.gates?.workFormat?.status === 'blocked';
}

function capitalized(text: string): string {
  return text.charAt(0).toLocaleUpperCase('ru-RU') + text.slice(1);
}

export interface VacancyRowStatus {
  readonly tone: 'ok' | 'warn' | 'unknown';
  readonly label: string;
}

/** Статус строки 390 — из тех же отметок совпадения, что колонки «Уровень» и «Гео» на 1440. */
export function vacancyRowStatus(item: MatchedVacancyItem): VacancyRowStatus {
  if (item.explanation.outsideGeography) return { tone: 'warn', label: 'Другой город' };
  if (formatGateBlocked(item)) {
    const format = workFormatLabel(vacancyFormat(item));
    return {
      tone: 'warn',
      label: format ? `${capitalized(format)}, не подходит` : 'Формат не подходит',
    };
  }
  const level = item.explanation.levelMatch;
  if (level === 'above' || level === 'below') return { tone: 'warn', label: 'Другой уровень' };
  if (level === 'unknown') return { tone: 'unknown', label: 'Уровень не указан' };
  return { tone: 'ok', label: 'Подходит' };
}

function VacancyScreenStatusCell({ item }: { readonly item: MatchedVacancyItem }) {
  const status = vacancyRowStatus(item);
  const Icon =
    status.tone === 'ok'
      ? CheckCircle
      : status.tone === 'unknown'
        ? Question
        : status.label === 'Другой город'
          ? MapPin
          : WarningCircle;
  return (
    <span className={`vacancies-screen-cell vacancies-screen-cell--status is-${status.tone}`}>
      <Icon aria-hidden="true" />
      {status.label}
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
      <VacancyScreenStatusCell item={item} />
    </>
  );
}
