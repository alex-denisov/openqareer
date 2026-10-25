import type { VacancySubscription } from '../coach/coachApi';
import { SavedSearchesPanel } from './SavedSearchesPanel';

export type OpportunityTab = 'selection' | 'saved' | 'companies';

const tabCount = new Intl.NumberFormat('ru-RU');

export function OpportunityTabs({
  active,
  totalVacancies,
  savedCount,
  companiesCount,
  onSelect,
  selectionOnly = false,
}: {
  readonly active: OpportunityTab;
  readonly totalVacancies: number;
  readonly savedCount: number;
  readonly companiesCount?: number;
  readonly onSelect: (tab: OpportunityTab) => void;
  /** Режим карты (макет 4): под вкладками только «Подборка». */
  readonly selectionOnly?: boolean;
}) {
  const allTabs: Array<{ id: OpportunityTab; name: string; count?: string }> = [
    { id: 'selection', name: 'Подборка', count: tabCount.format(totalVacancies) },
    { id: 'saved', name: 'Сохранённые', count: String(savedCount) },
    {
      id: 'companies',
      name: 'Компании и люди',
      count: companiesCount === undefined ? undefined : String(companiesCount),
    },
  ];
  const tabs = selectionOnly ? allTabs.filter((tab) => tab.id === 'selection') : allTabs;
  return (
    <div className="companies-people-tabs" role="tablist" aria-label="Разделы вакансий">
      {tabs.map((tab) => (
        <button
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          aria-label={tab.count === undefined ? tab.name : `${tab.name} ${tab.count}`}
          className="companies-people-tab"
          key={tab.id}
          onClick={() => onSelect(tab.id)}
        >
          <span className="opportunity-tab-label-desktop">
            {tab.name}
            {tab.count === undefined ? null : <span className="tab-count">{tab.count}</span>}
          </span>
          <span className="opportunity-tab-label-mobile">
            {tab.id === 'companies' ? 'Компании' : tab.id === 'saved' ? 'Сохранённые' : 'Подборка'}
          </span>
        </button>
      ))}
    </div>
  );
}

export function SavedSearchesSection({
  open,
  subscriptions,
  onClose,
  onRefresh,
  defaultQuery,
}: {
  readonly defaultQuery?: string;
  readonly open: boolean;
  readonly subscriptions?: readonly VacancySubscription[];
  readonly onClose: () => void;
  readonly onRefresh?: () => Promise<void>;
}) {
  if (!open) return null;
  return (
    <div className="filters-panel is-expanded" aria-label="Сохранённые поиски">
      <div className="filters-panel-head">
        <h3>Сохранённые поиски</h3>
        <button type="button" className="filters-reset" onClick={onClose}>
          Свернуть
        </button>
      </div>
      <SavedSearchesPanel
        subscriptions={subscriptions ?? []}
        defaultQuery={defaultQuery}
        onRefresh={onRefresh ?? (async () => {})}
      />
    </div>
  );
}
