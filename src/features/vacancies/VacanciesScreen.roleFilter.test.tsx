// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { CampaignMetaView } from '../coach/matchedVacancyApi';
import { VacanciesScreen } from './VacanciesScreen';

function matchedItem(id: string, title: string): MatchedVacancyItem {
  return {
    cluster: {
      id,
      canonicalTitle: title,
      canonicalCompany: 'Genetec',
      canonicalLocation: 'Дубай',
      isRemote: false,
      descriptionSummary: '',
      skills: [],
      primaryUrl: 'https://example.com',
      sources: [],
      firstObservedAt: '2026-09-24T08:00:00.000Z',
      lastSeenAt: '2026-09-24T08:00:00.000Z',
      status: 'active',
      vacanciesCount: 1,
    },
    explanation: {
      clusterId: id,
      roleMatch: 'target',
      levelMatch: 'match',
      outsideGeography: false,
      matchingPoints: [],
      missingPoints: [],
      summary: '',
      calculatedAt: '2026-09-24T08:00:00.000Z',
    },
  };
}

const campaign: CampaignMetaView = {
  roles: { value: ['VP Technology Ops', 'COO'], origin: 'profile' },
  regions: { value: ['Дубай'], origin: 'profile' },
  remoteOnly: false,
  roleHypotheses: [
    { role: 'VP Technology Ops', vacancyCount: 34, isHypothesis: false },
    { role: 'COO', vacancyCount: 34, isHypothesis: false },
  ],
};

const facets = { total: 2, regions: [{ id: 'mena' as const, count: 2 }], remote: 0, levels: [],
  roles: [{ role: 'VP Technology Ops', count: 1 }, { role: 'COO', count: 1 }], sources: [] };

describe('VacanciesScreen — фильтр ролей (C56)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('по умолчанию показывает вакансии всех ролей кампании', async () => {
    await act(async () => {
      root.render(
        <VacanciesScreen
          matched={[matchedItem('c-1', 'VP Technology Ops'), matchedItem('c-2', 'COO')]}
          total={2}
          campaign={campaign}
          facets={facets}
          now="2026-09-24T09:00:00.000Z"
        />,
      );
    });
    expect(container.textContent).toContain('VP Technology Ops');
    expect(container.textContent).toContain('COO');
    const allRolesButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Все роли кампании',
    );
    expect(allRolesButton).toBeUndefined();
    expect(container.textContent).toContain('Фильтры · 0 активных');
  });

  it('сужает список до выбранной роли и позволяет вернуться ко «Всем ролям»', async () => {
    await act(async () => {
      root.render(
        <VacanciesScreen
          matched={[matchedItem('c-1', 'VP Technology Ops'), matchedItem('c-2', 'COO')]}
          total={2}
          campaign={campaign}
          facets={facets}
          now="2026-09-24T09:00:00.000Z"
        />,
      );
    });

    const cooButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.startsWith('COO'),
    );
    await act(async () => cooButton?.click());

    const list = container.querySelector('.vac-list');
    expect(list?.textContent).toContain('COO');
    expect(list?.textContent).not.toContain('VP Technology Ops');

    const allRolesButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Все роли кампании',
    );
    expect(allRolesButton).toBeUndefined();
    await act(async () => cooButton?.click());
    const restoredList = container.querySelector('.vac-list');
    expect(restoredList?.textContent).toContain('VP Technology Ops');
    expect(restoredList?.textContent).toContain('COO');
  });

  it('изменение фильтра запрашивает первую страницу, без подсказок из кампании', async () => {
    const changes: unknown[] = [];
    await act(async () => root.render(<VacanciesScreen
      matched={[matchedItem('c-1', 'VP Technology Ops')]} total={2} facets={facets}
      campaign={{ ...campaign, suggestedRegions: ['us'], remoteOnly: true }}
      onFiltersChange={(state) => changes.push(state)} />));
    expect(container.textContent).not.toContain('Добавить:');
    expect(changes[0]).toEqual({ roles: [], regions: [], levels: [], sources: [], remoteOnly: false });
    const region = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('MENA · 2'));
    await act(async () => region?.click());
    expect(changes.at(-1)).toEqual({ roles: [], regions: ['mena'], levels: [], sources: [], remoteOnly: false });
  });
});
