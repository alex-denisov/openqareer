import { AirplaneTilt, CurrencyDollar, GlobeHemisphereEast, type Icon } from '@phosphor-icons/react';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { VacancyFilters } from './vacancyFilters';

type CompanyFeatures = NonNullable<MatchedVacancyItem['cluster']['companyFeatures']>;

/**
 * Особые условия работодателя — одно имя и одна иконка на бейдж в строке,
 * карточку на карте, строку фильтра и чип активного фильтра (B236 §4.3, §4.5).
 * Раньше легенда «Релокация» стояла над строкой «Валютная удалёнка», а в
 * строке те же условия звались иначе и рисовались эмодзи.
 */
export interface VacancyCondition {
  readonly feature: 'relocation' | 'currencyRemote' | 'russianAbroad';
  readonly filter: Extract<
    keyof VacancyFilters,
    'relocationOnly' | 'currencyRemoteOnly' | 'russianAbroadOnly'
  >;
  readonly label: string;
  readonly Icon: Icon;
  readonly badgeClass: string;
}

export const VACANCY_CONDITIONS: readonly VacancyCondition[] = [
  {
    feature: 'relocation',
    filter: 'relocationOnly',
    label: 'Релокация',
    Icon: AirplaneTilt,
    badgeClass: 'is-reloc',
  },
  {
    feature: 'currencyRemote',
    filter: 'currencyRemoteOnly',
    label: 'Оплата в валюте',
    Icon: CurrencyDollar,
    badgeClass: 'is-currency',
  },
  {
    feature: 'russianAbroad',
    filter: 'russianAbroadOnly',
    label: 'Рос. компании за рубежом',
    Icon: GlobeHemisphereEast,
    badgeClass: 'is-ru-abroad',
  },
];

/** Бейджи условий вакансии: иконка + короткая подпись, без эмодзи. */
export function VacancyConditionBadges({
  features,
}: {
  readonly features?: CompanyFeatures | null;
}) {
  if (!features) return null;
  const present = VACANCY_CONDITIONS.filter((condition) => features[condition.feature]);
  const ats = features.atsProvider;
  if (present.length === 0 && !ats) return null;

  return (
    <span className="career-vacancy-feature-badges">
      {present.map(({ feature, label, Icon, badgeClass }) => (
        <span key={feature} className={`career-feature-badge ${badgeClass}`}>
          <Icon size={12} aria-hidden="true" />
          {label}
        </span>
      ))}
      {ats ? <span className="career-feature-badge is-ats">ATS: {ats}</span> : null}
    </span>
  );
}
