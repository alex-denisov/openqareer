import { describe, expect, it } from 'vitest';
import { evaluateCountryFit } from './index';
import type { MobilityCandidateProfile } from './types';

const russianWith = (
  kind: 'residence_permit' | 'work_permit' | 'work_visa',
  expiresAt: string | undefined,
): MobilityCandidateProfile => ({
  citizenshipCountryCodes: ['RU'],
  residenceDocuments: [{ kind, countryCode: 'RS', ...(expiresAt ? { expiresAt } : {}) }],
  asOf: '2026-10-22',
});

const domestic = (fit: ReturnType<typeof evaluateCountryFit>) =>
  fit.scenarios.find(({ id }) => id === 'domestic_market');

describe('Country Fit residence documents (B468-r3)', () => {
  it('a valid residence permit opens the country with the document as the reason', () => {
    const fit = evaluateCountryFit('RS', russianWith('residence_permit', '2027-06-30'));
    expect(fit.status).toBe('available');
    expect(domestic(fit)?.status).toBe('available');
    expect(domestic(fit)?.reasons).toEqual(['Действует ВНЖ до 30.06.2027.']);
  });

  it('a permit ending within six months asks to renew it', () => {
    const fit = evaluateCountryFit('RS', russianWith('residence_permit', '2027-03-14'));
    expect(fit.status).toBe('available');
    expect(domestic(fit)?.reasons).toEqual([
      'Действует ВНЖ до 14.03.2027, срок скоро нужно продлить.',
    ]);
  });

  it('a work permit opens the country too', () => {
    const fit = evaluateCountryFit('RS', russianWith('work_permit', '2028-01-01'));
    expect(fit.status).toBe('available');
    expect(domestic(fit)?.reasons).toEqual(['Действует разрешение на работу до 01.01.2028.']);
  });

  it('an expired permit gives no access and says when it expired', () => {
    const fit = evaluateCountryFit('RS', russianWith('residence_permit', '2026-01-10'));
    expect(fit.status).not.toBe('available');
    expect(domestic(fit)?.status).not.toBe('available');
    expect(domestic(fit)?.reasons).toEqual(['ВНЖ истёк 10.01.2026.']);
  });

  it('a work visa is not a residence right and stays with the scenario rules', () => {
    const fit = evaluateCountryFit('RS', russianWith('work_visa', '2027-06-30'));
    expect(domestic(fit)?.status).not.toBe('available');
  });

  it('a permit in another country does not open this one', () => {
    const fit = evaluateCountryFit('DE', russianWith('residence_permit', '2027-06-30'));
    expect(domestic(fit)?.status).not.toBe('available');
  });

  it('citizenship without documents keeps the old behaviour', () => {
    const fit = evaluateCountryFit('RS', { citizenshipCountryCodes: ['RU'], asOf: '2026-10-22' });
    expect(domestic(fit)?.status).not.toBe('available');
  });
});
