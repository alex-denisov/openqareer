import type { VacancySubscription } from '../coach/coachApi';
import { SavedSearchesPanel } from './SavedSearchesPanel';

export type OpportunityTab = 'selection' | 'saved' | 'companies';

export function OpportunityTabs({
  active,
  totalVacancies,
  savedCount,
  onSelect,
}: {
  readonly active: OpportunityTab;
  readonly totalVacancies: number;
  readonly savedCount: number;
  readonly onSelect: (tab: OpportunityTab) => void;
}) {
  const tabs: Array<{ id: OpportunityTab; label: string }> = [
    { id: 'selection', label: `Подборка ${totalVacancies}` },
    { id: 'saved', label: `Сохранённые ${savedCount}` },
    { id: 'companies', label: 'Компании и люди' },
  ];
  return (
    <div className="companies-people-tabs" role="tablist" aria-label="Разделы вакансий">
      {tabs.map((tab) => (
        <button
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          className="companies-people-tab"
          key={tab.id}
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
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
