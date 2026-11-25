import { expect, it } from 'vitest';
import { knownVacancy, rememberVacancy } from '../b640/shell/vacancyNames';
import { clearCareerCabinetCache } from './careerCabinetCache';

it('выход из аккаунта забывает названия вакансий (B798)', () => {
  rememberVacancy('v1', { vacancyId: 'v1', title: 'CTO', company: 'Acme' });
  expect(knownVacancy('v1')).not.toBeNull();
  clearCareerCabinetCache();
  expect(knownVacancy('v1')).toBeNull();
});
