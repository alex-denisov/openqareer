import { describe, expect, it } from 'vitest';

import { buildLocationTree } from '../../../shared/locationTree';
import {
  countryKeysForRegions,
  locationSelectionView,
  selectedLocationVacancies,
} from './campaignLocationSelection';
import type { VacanciesScreenState } from './vacanciesScreenState';

const places = [
  { location: 'Москва', region: 'ru' as const, count: 31 },
  { location: 'Тверь', region: 'ru' as const, count: 16 },
  { location: 'Алматы, Казахстан', region: 'cis' as const, count: 5 },
  { location: 'Austin, TX', country: 'United States', region: 'us' as const, count: 900 },
  { isRemote: true, count: 7 },
];
const tree = buildLocationTree(places);
const empty: VacanciesScreenState = { roles: [], regions: [], remoteOnly: false };

/** B446-r (W6): чип «Россия, СНГ», а в поповере «Выбрано 0» и узла «Россия» нет. */
describe('campaign regions in «Локации»', () => {
  it('считает дерево по сводке всей выдачи, а не по загруженным строкам', () => {
    expect(tree.countries.find((node) => node.label === 'Россия')?.count).toBe(47);
    expect(tree.remote).toBe(7);
  });

  it('отмечает страны регионов кампании и считает выбранные вакансии', () => {
    expect(countryKeysForRegions(tree, places, ['ru', 'cis']).sort()).toEqual(
      ['Казахстан', 'Россия'].sort(),
    );
    const view = locationSelectionView(empty, tree, places, ['ru', 'cis']);
    expect(view.fromRegions).toBe(true);
    expect(selectedLocationVacancies(tree, view.state)).toBe(52);
  });

  it('ручной выбор важнее кампании', () => {
    const manual = { ...empty, selectedLocations: ['США'] };
    const view = locationSelectionView(manual, tree, places, ['ru']);
    expect(view.fromRegions).toBe(false);
    expect(selectedLocationVacancies(tree, view.state)).toBe(900);
  });
});
