import { describe, expect, it } from 'vitest';
import { HygienicResumeStructurer } from './hygienicResumeStructurer';
import type { ParsedResume } from '../../src/features/workspace/resumeParser';

/**
 * Разобранное моделью резюме — это текст модели, который кандидат видит в
 * «Студии резюме», правит и уносит в отклики. Невидимые метки в нём уезжают
 * дальше продукта: в ATS работодателя и в сканеры (B210).
 */
describe('HygienicResumeStructurer', () => {
  const dirty = {
    fullName: 'Алексей​Денисов',
    headline: 'Ведущий­инженер',
    experience: [{ company: 'ООО﻿Ромашка', title: 'Инженер', achievements: ['Сделал⁠дело'] }],
  } as unknown as ParsedResume;

  it('снимает невидимые метки со всего разобранного резюме', async () => {
    const structurer = new HygienicResumeStructurer({
      inner: { structure: async () => dirty },
    });
    const clean = (await structurer.structure('исходный текст резюме')) as unknown as {
      fullName: string;
      headline: string;
      experience: { company: string; achievements: string[] }[];
    };
    expect(clean.fullName).toBe('АлексейДенисов');
    expect(clean.headline).toBe('Ведущийинженер');
    expect(clean.experience[0].company).toBe('ООО Ромашка'.replace(' ', ''));
    expect(clean.experience[0].achievements[0]).toBe('Сделалдело');
  });

  it('чистый разбор возвращается тем же объектом, без пересборки', async () => {
    const parsed = { fullName: 'Алексей Денисов' } as unknown as ParsedResume;
    const structurer = new HygienicResumeStructurer({
      inner: { structure: async () => parsed },
    });
    await expect(structurer.structure('текст')).resolves.toBe(parsed);
  });

  it('молчание модели остаётся молчанием, а не пустым резюме', async () => {
    const structurer = new HygienicResumeStructurer({
      inner: { structure: async () => null },
    });
    await expect(structurer.structure('текст')).resolves.toBeNull();
  });
});
