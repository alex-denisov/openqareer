import { useRef } from 'react';
import type { CareerDiaryOverview } from '../../../shared/careerDiary';
import type { CareerDiaryTab } from './useCareerDiaryRecords';

interface CareerDiaryTabsProps {
  readonly activeTab: CareerDiaryTab;
  readonly overview: CareerDiaryOverview | null;
  readonly onChange: (tab: CareerDiaryTab) => void;
}

const TABS: readonly { readonly id: CareerDiaryTab; readonly label: string; readonly mobileLabel: string }[] = [
  { id: 'goals', label: 'Цели и KPI', mobileLabel: 'Цели' },
  { id: 'reviews', label: 'Разборы недель', mobileLabel: 'Разборы' },
  { id: 'achievements', label: 'Достижения в профиль', mobileLabel: 'Результаты' },
];

export function CareerDiaryTabs({ activeTab, overview, onChange }: CareerDiaryTabsProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  return (
    <div className="career-diary-tabs" role="tablist" aria-label="Карьерный дневник" tabIndex={-1} onKeyDown={(event) => {
      const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!direction) return;
      event.preventDefault();
      const current = TABS.findIndex((tab) => tab.id === activeTab);
      const next = (current + direction + TABS.length) % TABS.length;
      onChange(TABS[next]!.id);
      tabRefs.current[next]?.focus();
    }}>
      {TABS.map((tab, index) => (
        <button
          key={tab.id}
          ref={(element) => { tabRefs.current[index] = element; }}
          className="career-diary-tab"
          type="button"
          role="tab"
          id={`career-diary-tab-${tab.id}`}
          aria-selected={activeTab === tab.id}
          aria-controls={`career-diary-panel-${tab.id}`}
          tabIndex={activeTab === tab.id ? 0 : -1}
          onClick={() => onChange(tab.id)}
        >
          <span className="career-diary-tab__desktop-label">{tab.label}</span>
          <span className="career-diary-tab__mobile-label">{tab.mobileLabel}</span>
          {tabCount(tab.id, overview) !== null ? (
            <span className="career-diary-tab__count">{tabCount(tab.id, overview)}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function tabCount(tab: CareerDiaryTab, overview: CareerDiaryOverview | null): number | null {
  if (!overview) return null;
  if (tab === 'goals') return overview.summary.goalsTotal;
  if (tab === 'reviews') return overview.summary.weeklyReviewsTotal;
  return overview.summary.achievementsReadyToAdd;
}
