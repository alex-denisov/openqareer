import { describe, expect, it } from 'vitest';
import type { CandidateCompanyOpportunity } from '../../../../shared/candidateCompany';
import { validateAutomationDraft, type AutomationDraft } from './AutomationSheet';
import { companyWantFace } from './CompanyWantsScreen';
import { meterStep } from './ReviewScreen';
import { marksFor } from './useResponseActions';

function company(overrides: Partial<CandidateCompanyOpportunity>): CandidateCompanyOpportunity {
  return {
    key: 'k',
    name: 'Гринкод',
    location: null,
    industry: 'Финтех',
    vacancyCount: 0,
    contactsCount: null,
    contactsImportedAt: null,
    want: true,
    wantStage: 'want',
    nextStep: null,
    hasRecruiter: false,
    recruiterSearchStatus: 'idle',
    sources: [],
    vacancies: [],
    recruiters: [],
    ...overrides,
  } as CandidateCompanyOpportunity;
}

const DRAFT: AutomationDraft = {
  roles: ['Руководитель разработки'],
  platforms: ['hh', 'linkedin'],
  dayLimit: '30',
  letter: 'approval_required',
  pauseUntil: '',
};

describe('B656: «Хочу в компанию»', () => {
  it('новые вакансии важнее стадии', () => {
    const face = companyWantFace(company({ hasNewVacancies: true, vacancyCount: 2, contactsCount: 1, wantStage: 'waiting' }));
    expect(face.tag).toEqual({ tone: 'ok', label: 'новые вакансии' });
    expect(face.brief).toBe('2 вакансии · 1 знакомый');
  });

  it('без списка знакомых число знакомых не выдумывается', () => {
    expect(companyWantFace(company({ wantStage: 'path' }))).toMatchObject({
      tag: { tone: 'miss', label: 'ищу путь' },
      brief: 'нет вакансий',
    });
    expect(companyWantFace(company({ wantStage: 'waiting', contactsCount: 0 })).brief).toBe(
      'нет вакансий · знакомых нет',
    );
  });
});

describe('B656: отметка ответа', () => {
  it('предлагает только стадии после текущей', () => {
    expect(marksFor('applied').map((mark) => mark.stage)).toEqual(['responded', 'interview', 'offer', 'rejected', 'archived']);
    expect(marksFor('interview').map((mark) => mark.stage)).toEqual(['offer', 'rejected', 'archived']);
    expect(marksFor('saved').map((mark) => mark.stage)).toEqual(['archived']);
    expect(marksFor('rejected')).toEqual([]);
  });
});

describe('B656: настройки автооткликов', () => {
  it('пропускает верные настройки', () => {
    expect(validateAutomationDraft(DRAFT, true)).toBeNull();
  });

  it('называет ошибку поля', () => {
    expect(validateAutomationDraft({ ...DRAFT, roles: [] }, true)).toMatch(/роль/u);
    expect(validateAutomationDraft({ ...DRAFT, roles: [] }, false)).toBeNull();
    expect(validateAutomationDraft({ ...DRAFT, platforms: [] }, true)).toMatch(/площадку/u);
    expect(validateAutomationDraft({ ...DRAFT, dayLimit: '51' }, true)).toMatch(/Лимит/u);
    expect(validateAutomationDraft({ ...DRAFT, dayLimit: '1' }, true)).toMatch(/Лимит/u);
    expect(validateAutomationDraft({ ...DRAFT, pauseUntil: '2000-01-01' }, true)).toMatch(/паузы/u);
  });
});

describe('B656: полоса «мало данных»', () => {
  it('округляет до шага 5 % и не выходит за края', () => {
    expect(meterStep(6, 20)).toBe(30);
    expect(meterStep(0, 20)).toBe(0);
    expect(meterStep(25, 20)).toBe(100);
    expect(meterStep(1, 0)).toBe(0);
  });
});
