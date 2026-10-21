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

const facets = {
  total: 2,
  regions: [{ id: 'mena' as const, count: 2 }],
  remote: 0,
  levels: [],
  roles: [
    { role: 'VP Technology Ops', count: 1 },
    { role: 'COO', count: 1 },
  ],
  sources: [],
};

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
    expect(container.textContent).toContain('Фильтры 0');
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

    const rolesGroup = () =>
      container.querySelector<HTMLButtonElement>('button[data-filter-group="roles"]');
    await act(async () => rolesGroup()?.click());
    // B547: «Роли» — чекбоксы ролей кампании; снятие VP оставляет COO.
    const roleBox = (role: string) =>
      Array.from(
        container.querySelectorAll<HTMLLabelElement>('[data-testid="role-tree-filter"] label'),
      )
        .find((label) => label.textContent === role)
        ?.querySelector('input');
    expect(roleBox('COO')?.checked).toBe(true);
    await act(async () => roleBox('VP Technology Ops')?.click());
    const apply = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Применить',
    );
    await act(async () => apply?.click());

    const list = container.querySelector('.vac-list');
    expect(list?.textContent).toContain('COO');
    const visibleTitles = Array.from(list?.querySelectorAll('.vac-title') ?? []).map(
      (title) => title.textContent,
    );
    expect(visibleTitles).toEqual(['COO']);

    const allRolesButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Все роли кампании',
    );
    expect(allRolesButton).toBeUndefined();
    expect(rolesGroup()?.getAttribute('aria-expanded')).toBe('false');
    await act(async () => rolesGroup()?.click());
    expect(rolesGroup()?.getAttribute('aria-expanded')).toBe('true');
    expect(roleBox('VP Technology Ops')?.checked).toBe(false);
    await act(async () => roleBox('VP Technology Ops')?.click());
    expect(roleBox('VP Technology Ops')?.checked).toBe(true);
    const applyAgain = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Применить',
    );
    await act(async () => applyAgain?.click());
    const restoredList = container.querySelector('.vac-list');
    expect(restoredList?.textContent).toContain('VP Technology Ops');
    expect(restoredList?.textContent).toContain('COO');
  });

  it('изменение фильтра запрашивает первую страницу, без подсказок из кампании', async () => {
    const changes: unknown[] = [];
    await act(async () =>
      root.render(
        <VacanciesScreen
          matched={[matchedItem('c-1', 'VP Technology Ops')]}
          total={2}
          facets={facets}
          campaign={{ ...campaign, suggestedRegions: ['us'], remoteOnly: true }}
          onFiltersChange={(state) => changes.push(state)}
        />,
      ),
    );
    expect(container.textContent).not.toContain('Добавить:');
    expect(changes[0]).toEqual({
      roles: [],
      regions: [],
      levels: [],
      sources: [],
      remoteOnly: false,
    });
    const locations = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Локации',
    );
    await act(async () => locations?.click());
    // B547: «Локации» — дерево по выдаче, макрорегионов кампании в нём нет.
    expect(container.textContent).not.toContain('MENA · 2');
    const remote = container.querySelector<HTMLInputElement>(
      '[data-testid="location-tree-filter"] input[type="checkbox"]',
    );
    await act(async () => remote?.click());
    const apply = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Применить',
    );
    await act(async () => apply?.click());
    expect(changes.at(-1)).toEqual({
      roles: [],
      regions: [],
      levels: [],
      sources: [],
      remoteOnly: false,
      locationRemote: true,
    });
  });
  it('счётчик учитывает выбранный на карте город и возвращает серверный total при очистке', async () => {
    const mapped = (id: string, city: string, lat: number, lng: number): MatchedVacancyItem => {
      const item = matchedItem(id, 'COO');
      return {
        ...item,
        cluster: {
          ...item.cluster,
          canonicalLocation: city,
          companyFeatures: { city, coordinates: { lat, lng } },
        },
      };
    };
    await act(async () =>
      root.render(
        <VacanciesScreen
          matched={[
            mapped('c-1', 'Амстердам', 52.3676, 4.9041),
            mapped('c-2', 'Москва', 55.7558, 37.6173),
          ]}
          total={8}
          facets={{ ...facets, total: 12 }}
        />,
      ),
    );
    const counter = () =>
      container.querySelector('.list-hint[aria-live="polite"]')?.getAttribute('aria-label');
    expect(counter()).toBe('Показано 8 из 12');
    const mapTab = Array.from(container.querySelectorAll('[role="tab"]')).find(
      (tab) => tab.textContent === 'Карта',
    );
    await act(async () => (mapTab as HTMLButtonElement).click());
    // B446-g4: город на карте открывает список с фильтром этого города.
    const city = container.querySelector('[aria-label^="Город Амстердам"]');
    expect(city).not.toBeNull();
    await act(async () => city?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(counter()).toBe('Показано 1 из 12');
    expect(container.querySelector('.vacancies-list-container')).not.toBeNull();
    expect(container.querySelector('.career-map-active-bar')?.textContent).toContain('Амстердам');
    const clear = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Все города',
    );
    await act(async () => clear?.click());
    expect(counter()).toBe('Показано 8 из 12');
  });
});
