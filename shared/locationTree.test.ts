import { describe, expect, it } from 'vitest';

import {
  buildLocationTree,
  locationNodeState,
  matchesLocationSelection,
  parseVacancyLocation,
  searchLocationTree,
  toggleLocationNode,
} from './locationTree';

const places = [
  { location: 'Москва', isRemote: false },
  { location: 'Москва', isRemote: false },
  { location: 'Тверь', isRemote: false },
  { location: 'Санкт-Петербург', isRemote: false },
  { location: 'San Francisco, CA, United States', isRemote: false },
  { location: 'New York, NY, United States', isRemote: false },
  { location: 'New York, NY, United States', isRemote: false },
  { location: 'Jersey City, New Jersey, United States', isRemote: false },
  { location: 'New Orleans, LA, United States', isRemote: false },
  { location: 'Berlin, Berlin, Germany', isRemote: false },
  { location: 'Remote', isRemote: true },
];

describe('parseVacancyLocation', () => {
  it('places a Russian city under its federal district', () => {
    expect(parseVacancyLocation({ location: 'Москва' })).toEqual({
      country: 'Россия',
      region: 'Центральный ФО',
      city: 'Москва',
    });
  });

  it('reads the US state from the place string', () => {
    expect(parseVacancyLocation({ location: 'San Francisco, CA, United States' })).toEqual({
      country: 'США',
      region: 'Калифорния',
      city: 'Сан-Франциско',
    });
  });

  it('names the country of a well-known city written alone', () => {
    expect(parseVacancyLocation({ location: 'Berlin' })).toEqual({
      country: 'Германия',
      region: 'Регион не указан',
      city: 'Берлин',
    });
  });

  it('puts a well-known US city written without a state into its state (B547)', () => {
    const withState = parseVacancyLocation({ location: 'New York, NY' });
    expect(parseVacancyLocation({ location: 'New York, United States' })).toEqual(withState);
    expect(parseVacancyLocation({ location: 'New York' })).toEqual(withState);
    expect(withState).toEqual({ country: 'США', region: 'Нью-Йорк', city: 'Нью-Йорк' });
  });

  it('keeps an unknown place unknown', () => {
    expect(parseVacancyLocation({ location: 'Remote' })).toBeUndefined();
  });
});

describe('buildLocationTree', () => {
  it('counts vacancies per node and remote separately', () => {
    const tree = buildLocationTree(places);
    expect(tree.remote).toBe(1);
    const russia = tree.countries.find((node) => node.label === 'Россия')!;
    expect(russia.count).toBe(4);
    const central = russia.children.find((node) => node.label === 'Центральный ФО')!;
    expect(central.count).toBe(3);
    expect(central.children.map((node) => [node.label, node.count])).toEqual([
      ['Москва', 2],
      ['Тверь', 1],
    ]);
    expect(tree.countries[0]!.label).toBe('Россия');
  });
});

describe('selection', () => {
  const tree = buildLocationTree(places);
  const russia = tree.countries.find((node) => node.label === 'Россия')!;
  const central = russia.children.find((node) => node.label === 'Центральный ФО')!;
  const moscow = central.children[0]!;

  it('checking a region selects all its cities', () => {
    const selected = toggleLocationNode([], central, tree);
    expect(locationNodeState(central, selected)).toBe('checked');
    expect(locationNodeState(moscow, selected)).toBe('checked');
    expect(locationNodeState(russia, selected)).toBe('mixed');
  });

  it('unchecking a city inside a checked region leaves the siblings', () => {
    const selected = toggleLocationNode(toggleLocationNode([], central, tree), moscow, tree);
    expect(locationNodeState(moscow, selected)).toBe('none');
    expect(locationNodeState(central, selected)).toBe('mixed');
    expect(matchesLocationSelection({ location: 'Тверь' }, selected)).toBe(true);
    expect(matchesLocationSelection({ location: 'Москва' }, selected)).toBe(false);
  });

  it('checking every city collapses to the region', () => {
    const one = toggleLocationNode([], moscow, tree);
    const both = toggleLocationNode(one, central.children[1]!, tree);
    expect(both).toEqual([central.key]);
  });

  it('keeps legacy plain labels as substring matches', () => {
    expect(matchesLocationSelection({ location: 'Berlin, Germany' }, ['Berlin'])).toBe(true);
  });
});

describe('searchLocationTree', () => {
  it('finds cities and states with their path', () => {
    const hits = searchLocationTree(buildLocationTree(places), 'нью');
    expect(hits.map((hit) => [hit.node.label, hit.kindLabel, hit.path])).toEqual([
      ['Нью-Йорк', 'город', 'США › штат Нью-Йорк'],
      ['Нью-Йорк', 'штат, все города', 'США'],
      ['Нью-Джерси', 'штат, все города', 'США'],
      ['Нью-Орлеан', 'город', 'США › штат Луизиана'],
    ]);
  });
});
