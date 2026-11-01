import { describe, expect, it } from 'vitest';
import { geoConditionBlocks, type GeoConditionContext } from './vacancyGeoConditions';

// Owner audit 01.11: the candidate lives in Dubai; the campaign is Moscow plus remote from Russia.
const geo: GeoConditionContext = {
  places: ['Россия › Центральный ФО › Москва'],
  countries: ['Россия', 'ОАЭ'],
  candidateLocation: 'Dubai, UAE',
};
const ids = (target: Parameters<typeof geoConditionBlocks>[0]) =>
  geoConditionBlocks(target, geo).map((block) => block.requirementId);

describe('conditions read from the vacancy text and location (02.11 audit)', () => {
  it('V05 ЛАВКА СЧАСТЬЯ: onsite in Липецк is outside Moscow and Dubai', () => {
    const blocks = geoConditionBlocks(
      {
        location: 'Липецк',
        isRemote: false,
        description: 'Мы развиваем франчайзинговую сеть в Туле и Рязани.',
      },
      geo,
    );
    expect(blocks).toEqual([
      {
        requirementId: 'geo:onsite',
        text: 'работа на месте: Липецк',
        quote: 'Местоположение: Dubai, UAE',
      },
    ]);
  });

  it('V09 Xero: hybrid in San Mateo or Melbourne/Sydney', () => {
    const description =
      'Locations\n- San Mateo, California, USA (Hybrid)\n- Australia, Melbourne, Sydney (Hybrid)';
    expect(
      ids({ location: 'AU: Melbourne: (260 Burwood Rd)', isRemote: false, description }),
    ).toContain('geo:onsite');
  });

  it('V20 Wiz, V32, V56: remote only within the US', () => {
    expect(
      ids({ location: 'Remote', isRemote: true, description: 'Remote - USA | Sales' }),
    ).toEqual(['geo:country']);
    expect(
      ids({
        location: 'Remote',
        isRemote: true,
        description:
          'this candidate must be located within the US and be eligible to work in the US without sponsorship.',
      }),
    ).toEqual(['geo:country']);
    expect(
      ids({
        location: 'United States',
        isRemote: true,
        description:
          'can be performed remotely (within the US) regardless of any specified location above.',
      }),
    ).toEqual(['geo:country']);
  });

  it('keeps Moscow, Dubai, remote from Russia and US salary notes unblocked', () => {
    expect(
      ids({ location: 'Москва', isRemote: false, description: 'Гибрид, офис в Москве' }),
    ).toEqual([]);
    expect(ids({ location: 'Dubai', isRemote: false, description: 'On-site role' })).toEqual([]);
    expect(ids({ location: 'Россия', isRemote: true, description: 'Удалённо из РФ' })).toEqual([]);
    expect(
      ids({
        location: 'Remote',
        isRemote: true,
        description: 'The US-based salary range for this position is $216,500',
      }),
    ).toEqual([]);
  });
});
