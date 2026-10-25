import { useMemo, useState } from 'react';
import {
  ArrowRight,
  CaretRight,
  CheckCircle,
  Info,
  ListChecks,
  Plus,
  Prohibit,
  SlidersHorizontal,
  WarningCircle,
  type Icon,
} from '@phosphor-icons/react';
import type { RelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import {
  countryFitForQuestionnaire,
  listRelocationCountries,
  type RelocationCountry,
} from './relocationCountryData';
import {
  sortRelocationCountries,
  summarizeRelocationCountry,
  visibleRelocationCountries,
} from './relocationCountrySummary';
import { RelocationScenarioSheet, type RelocationScenarioFilter } from './RelocationScenarioSheet';
import type { RelocationWorkspaceState } from './useRelocationWorkspace';

const PREVIEW_COUNT = 7;
const MOBILE_STATUS: Readonly<Record<string, { readonly label: string; readonly icon: Icon }>> = {
  available: { label: 'Без ограничений', icon: CheckCircle },
  barriers: { label: 'Есть условия', icon: Info },
  high_barriers: { label: 'Высокие барьеры', icon: WarningCircle },
  legally_unavailable: { label: 'Недоступно юридически', icon: Prohibit },
  unknown: { label: 'Нужно уточнить', icon: Info },
};

export interface RelocationMobileCountryListProps {
  readonly profile: RelocationQuestionnaire;
  readonly workspace: RelocationWorkspaceState;
  readonly onOpenCountry: (countryCode: string) => void;
}

/** Mockup 15 at 390 `?frame`: grouped country rows, scenario sheet (`sheet=rls`), add and compare. */
export function RelocationMobileCountryList({
  profile,
  workspace,
  onOpenCountry,
}: RelocationMobileCountryListProps) {
  const [scenario, setScenario] = useState<RelocationScenarioFilter>('all');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const filtered = useFilteredCountries(profile, scenario);
  const visible = showAll
    ? filtered
    : visibleRelocationCountries(filtered, PREVIEW_COUNT, workspace.pinnedCountryCodes);
  const selected = workspace.selectedCountryCodes.length;
  return (
    <div className="career-relocation-mobile-section career-relocation-mobile-countries">
      <ScenarioButton chosen={scenario !== 'all'} onOpen={() => setSheetOpen(true)} />
      <p className="career-relocation-mobile-count">
        <strong>{visible.length}</strong> из {filtered.length} стран под ваш профиль
      </p>
      <CountryRows countries={visible} profile={profile} onOpenCountry={onOpenCountry} />
      <p className="career-relocation-mobile-foot">
        Показаны страны, где есть вакансии по вашим ролям и проверенные правила, сначала доступные,
        затем с условиями и барьерами. Нужной страны нет в списке? Добавьте её сами.
      </p>
      <ListActions
        onAdd={workspace.openAddCountry}
        hiddenCount={showAll ? 0 : filtered.length - visible.length}
        total={filtered.length}
        onShowAll={() => setShowAll(true)}
      />
      <CompareFooter selected={selected} onCompare={() => workspace.showTab('comparison')} />
      {sheetOpen ? (
        <RelocationScenarioSheet
          value={scenario}
          onChange={setScenario}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
    </div>
  );
}

function useFilteredCountries(
  profile: RelocationQuestionnaire,
  scenario: RelocationScenarioFilter,
) {
  const countries = useMemo(() => listRelocationCountries(), []);
  return sortRelocationCountries(
    countries.filter(
      (country) =>
        scenario === 'all' ||
        countryFitForQuestionnaire(country.countryCode, profile).scenarios.some(
          ({ id, status }) => id === scenario && status !== 'unknown',
        ),
    ),
    profile,
  );
}

function CountryRows({
  countries,
  profile,
  onOpenCountry,
}: {
  readonly countries: readonly RelocationCountry[];
  readonly profile: RelocationQuestionnaire;
  readonly onOpenCountry: (countryCode: string) => void;
}) {
  if (!countries.length)
    return (
      <p className="career-relocation-empty" role="status">
        Стран с таким сценарием нет.
      </p>
    );
  return (
    <ul className="career-relocation-group-list">
      {countries.map((country) => {
        const summary = summarizeRelocationCountry(country, profile);
        const status = MOBILE_STATUS[summary.status] ?? MOBILE_STATUS.unknown;
        const StatusIcon = status.icon;
        return (
          <li key={country.countryCode}>
            <button type="button" onClick={() => onOpenCountry(country.countryCode)}>
              <span className="career-relocation-mobile-country">
                <strong>{summary.name}</strong>
                <span>{summary.scenarioLabel}</span>
                <span className={`career-relocation-mobile-status is-${summary.status}`}>
                  <StatusIcon aria-hidden="true" size={14} />
                  {status.label}
                </span>
              </span>
              <CaretRight aria-hidden="true" size={16} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ListActions({
  onAdd,
  hiddenCount,
  total,
  onShowAll,
}: {
  readonly onAdd: () => void;
  readonly hiddenCount: number;
  readonly total: number;
  readonly onShowAll: () => void;
}) {
  return (
    <ul className="career-relocation-group-list">
      <li>
        <button type="button" onClick={onAdd}>
          <span className="career-relocation-mobile-action">
            <span className="career-relocation-mobile-action-icon">
              <Plus aria-hidden="true" size={16} />
            </span>
            Добавить страну
          </span>
          <CaretRight aria-hidden="true" size={16} />
        </button>
      </li>
      {hiddenCount > 0 ? (
        <li>
          <button type="button" onClick={onShowAll}>
            <span className="career-relocation-mobile-action">
              <span className="career-relocation-mobile-action-icon">
                <ListChecks aria-hidden="true" size={16} />
              </span>
              Показать все {total}
            </span>
            <CaretRight aria-hidden="true" size={16} />
          </button>
        </li>
      ) : null}
    </ul>
  );
}

function ScenarioButton({
  chosen,
  onOpen,
}: {
  readonly chosen: boolean;
  readonly onOpen: () => void;
}) {
  return (
    <button
      className="career-relocation-mobile-scenario"
      type="button"
      aria-haspopup="dialog"
      onClick={onOpen}
    >
      <SlidersHorizontal aria-hidden="true" size={17} />
      {chosen ? 'Сценарий: выбран' : 'Сценарий'}
    </button>
  );
}

function CompareFooter({
  selected,
  onCompare,
}: {
  readonly selected: number;
  readonly onCompare: () => void;
}) {
  return (
    <>
      <button
        className="career-relocation-mobile-cta"
        type="button"
        disabled={selected < 2}
        onClick={onCompare}
      >
        <ArrowRight aria-hidden="true" size={17} />
        Сравнить страны
      </button>
      {selected < 2 ? (
        <p className="career-relocation-muted">
          Для сравнения выбрано {selected} из 3: откройте страну и нажмите «В сравнение».
        </p>
      ) : null}
      <p className="career-relocation-mobile-note">
        <Info aria-hidden="true" size={17} />
        <span>
          Справочная информация по открытым источникам, не юридическая консультация. Пороги и
          правила меняются: проверьте на официальном портале.
        </span>
      </p>
    </>
  );
}
