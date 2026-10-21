import { useMemo, useState } from 'react';
import { ArrowRight, CaretRight, Plus, SlidersHorizontal } from '@phosphor-icons/react';
import type { RelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import {
  countryFitForQuestionnaire,
  listRelocationCountries,
  type RelocationCountry,
} from './relocationCountryData';
import { summarizeRelocationCountry, visibleRelocationCountries } from './relocationCountrySummary';
import { RelocationScenarioSheet, type RelocationScenarioFilter } from './RelocationScenarioSheet';
import type { RelocationWorkspaceState } from './useRelocationWorkspace';

const PREVIEW_COUNT = 7;

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
    <div className="career-relocation-mobile-section">
      <ScenarioButton chosen={scenario !== 'all'} onOpen={() => setSheetOpen(true)} />
      <CountryRows countries={visible} profile={profile} onOpenCountry={onOpenCountry} />
      <ListActions
        onAdd={workspace.openAddCountry}
        hiddenCount={showAll ? 0 : filtered.length - visible.length}
        total={filtered.length}
        onShowAll={() => setShowAll(true)}
      />
      <p className="career-relocation-muted">
        Для сравнения выбрано {selected} из 3: откройте страну и нажмите «В сравнение».
      </p>
      <button
        className="career-btn career-btn-primary"
        type="button"
        disabled={selected < 2}
        onClick={() => workspace.showTab('comparison')}
      >
        <ArrowRight aria-hidden="true" size={17} />
        Сравнить страны
      </button>
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
  return countries.filter(
    (country) =>
      scenario === 'all' ||
      countryFitForQuestionnaire(country.countryCode, profile).scenarios.some(
        ({ id, status }) => id === scenario && status !== 'unknown',
      ),
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
        return (
          <li key={country.countryCode}>
            <button type="button" onClick={() => onOpenCountry(country.countryCode)}>
              <span>
                <strong>{summary.name}</strong>
                <span>{summary.scenarioLabel}</span>
              </span>
              <span className={`career-relocation-mobile-status is-${summary.status}`}>
                {summary.statusLabel}
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
          <span>
            <Plus aria-hidden="true" size={16} /> Добавить страну
          </span>
          <CaretRight aria-hidden="true" size={16} />
        </button>
      </li>
      {hiddenCount > 0 ? (
        <li>
          <button type="button" onClick={onShowAll}>
            <span>Показать все {total}</span>
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
      className="career-relocation-text-action"
      type="button"
      aria-haspopup="dialog"
      onClick={onOpen}
    >
      <SlidersHorizontal aria-hidden="true" size={17} />
      {chosen ? 'Сценарий: выбран' : 'Сценарий'}
    </button>
  );
}
