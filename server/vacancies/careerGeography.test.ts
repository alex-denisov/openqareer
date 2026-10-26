import { describe, expect, it } from 'vitest';
import { DEFAULT_DECISION_PROFILE } from '../../shared/workPreferences';
import { careerGeographyOf, withinCareerGeography } from './careerGeography';

const owner = {
  ...DEFAULT_DECISION_PROFILE,
  searchLocations: ['Москва', 'Удалённо из РФ'],
  workFormats: ['office', 'home_market', 'remote_home'] as const,
};

describe('careerGeographyOf (CPO 26.10)', () => {
  it('turns «Карьера» cities and formats into places, remote and regions', () => {
    const geography = careerGeographyOf(owner);
    expect(geography?.labels).toEqual(['Москва', 'Удалённо из РФ']);
    expect(geography?.remote).toBe(true);
    expect(geography?.regions).toEqual(['ru']);
    expect(geography?.places).toHaveLength(1);
    expect(geography?.places[0]).toMatch(/^Россия › .+ › Москва$/u);
  });

  it('allows remote vacancies when the formats include remote work', () => {
    const geography = careerGeographyOf({
      ...DEFAULT_DECISION_PROFILE,
      searchLocations: ['Москва'],
      workFormats: ['remote_home'],
    });
    expect(geography?.remote).toBe(true);
  });

  it('is null without locations: the wizard regions stay in charge', () => {
    expect(careerGeographyOf(null)).toBeNull();
    expect(careerGeographyOf({ ...DEFAULT_DECISION_PROFILE, workFormats: ['office'] })).toBeNull();
  });

  it('keeps Moscow and remote vacancies, drops other cities', () => {
    const geography = careerGeographyOf(owner)!;
    const at = (location: string, isRemote = false) => ({
      cluster: { canonicalLocation: location, isRemote },
    });
    expect(withinCareerGeography(at('Moscow, Russia'), geography)).toBe(true);
    expect(withinCareerGeography(at('Москва'), geography)).toBe(true);
    expect(withinCareerGeography(at('Berlin, Germany', true), geography)).toBe(true);
    expect(withinCareerGeography(at('Санкт-Петербург'), geography)).toBe(false);
    expect(withinCareerGeography(at('Dubai, UAE'), geography)).toBe(false);
  });
});
