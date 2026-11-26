import { describe, expect, it } from 'vitest';
import type { HhEditsInput } from '../domain/hhResumeEdits';
import { editsCacheKey } from './hhResumeEditsInput';

const input = {
  resume: { id: 'r1', title: 'CIO', sections: { title: 'CIO', about: '', skills: [], places: [] } },
  vacancy: { title: 'CIO', requirements: [] },
  platform: {
    about: null,
    places: [{ id: 'p1', employer: 'Ромашка', aliases: [], bullets: ['Вела бэкенд.'] }],
    facts: [],
  },
} as unknown as HhEditsInput;

describe('B787 (k06): правка консультанта попадает в разбор под вакансию', () => {
  it('ключ разбора меняется, когда консультант поправил пункт профиля', () => {
    const applied = {
      ...input,
      platform: {
        ...input.platform,
        places: [{ ...input.platform.places[0]!, bullets: ['Руководила группой из 18 человек.'] }],
      },
    };
    expect(editsCacheKey('c1', applied, 'v1')).not.toBe(editsCacheKey('c1', input, 'v1'));
  });

  it('тот же профиль и резюме — тот же ключ', () => {
    expect(editsCacheKey('c1', { ...input }, 'v1')).toBe(editsCacheKey('c1', input, 'v1'));
  });
});
