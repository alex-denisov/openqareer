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
  it('счётчик учитывает выбранный на карте город и возвращает серверный total при очистке', async () => {
    const mapped = (id: string, city: string, lat: number, lng: number): MatchedVacancyItem => {
      const item = matchedItem(id, 'COO');
      return { ...item, cluster: { ...item.cluster, canonicalLocation: city,
        companyFeatures: { city, coordinates: { lat, lng } } } };
    };
    await act(async () => root.render(<VacanciesScreen
      matched={[mapped('c-1', 'Амстердам', 52.3676, 4.9041), mapped('c-2', 'Велдховен', 51.4172, 5.4055)]}
      total={8} facets={{ ...facets, total: 12 }} />));
    const counter = () => container.querySelector('.list-hint[aria-live="polite"]')?.textContent;
    expect(counter()).toBe('Показано 8 из 12');
    const mapTab = Array.from(container.querySelectorAll('[role="tab"]')).find((tab) =>
      tab.textContent === 'Карта');
    await act(async () => (mapTab as HTMLButtonElement).click());
    const city = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Амстердам'));
    expect(city).toBeDefined();
    await act(async () => city?.click());
    expect(counter()).toBe('Показано 1 из 12');
    expect(container.querySelectorAll('.career-map-cards-grid > *')).toHaveLength(1);
    const clear = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent === 'Все города на карте');
    await act(async () => clear?.click());
    expect(counter()).toBe('Показано 8 из 12');
  });

});
