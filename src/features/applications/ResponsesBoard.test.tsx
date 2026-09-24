import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ResponsesBoard } from './ResponsesBoard';
import type { ApplicationView } from './applicationsApi';
import type { UseApplications } from './useApplications';

function application(overrides: Partial<ApplicationView>): ApplicationView {
  return {
    id: 'a1',
    candidateId: 'c1',
    clusterId: 'cl1',
    stage: 'applied',
    closedReason: null,
    processProfile: 'standard',
    vacancy: { title: 'Senior Frontend Developer', company: 'FinCloud', url: 'https://x', source: 'hh' },
    notes: null,
    followUpDueAt: null,
    stageChangedAt: '2026-09-20T10:00:00.000Z',
    version: 1,
    createdAt: '2026-09-20T10:00:00.000Z',
    updatedAt: '2026-09-20T10:00:00.000Z',
    followUp: null,
    whoseTurn: 'company',
    materials: { coverLetter: true, resume: true },
    nearestInterview: null,
    ...overrides,
  };
}

function readyState(applications: readonly ApplicationView[]): UseApplications {
  return {
    status: 'ready',
    applications,
    offline: false,
    failedChanges: new Map(),
    conflicts: new Set(),
    reload: () => {},
    changeStage: () => {},
    retryStageChange: () => {},
    saveNote: () => {},
    addManualCard: async () => {},
    skip: async () => {},
  };
}

describe('ResponsesBoard columns', () => {
  it('groups applications into the six mockup columns with counts', () => {
    const applications = [
      application({ id: 'a1', stage: 'saved' }),
      application({ id: 'a2', stage: 'applied' }),
      application({ id: 'a3', stage: 'responded' }),
      application({ id: 'a4', stage: 'interview' }),
      application({ id: 'a5', stage: 'rejected' }),
      application({ id: 'a6', stage: 'archived' }),
    ];
    const html = renderToStaticMarkup(<ResponsesBoard state={readyState(applications)} />);

    ['Хочу', 'Откликнулся', 'Ответ', 'Интервью', 'Оффер', 'Отказ / Архив'].forEach((label) => {
      expect(html).toContain(label);
    });
    // The offer column has no cards and shows a zero count.
    const offerHead = html.indexOf('<h2>Оффер</h2>');
    expect(html.slice(offerHead, offerHead + 100)).toMatch(/>0</);
    // Rejected and archived share the sixth column.
    const closedHead = html.indexOf('<h2>Отказ / Архив</h2>');
    expect(html.slice(closedHead, closedHead + 100)).toMatch(/>2</);
  });

  it('renders card role, company and waiting label', () => {
    const applications = [
      application({
        id: 'a1',
        stage: 'applied',
        vacancy: { title: 'Enterprise Architect', company: 'Peraton', url: 'https://x', source: 'hh' },
        whoseTurn: 'company',
        materials: { coverLetter: true, resume: true },
      }),
    ];
    const html = renderToStaticMarkup(<ResponsesBoard state={readyState(applications)} />);

    expect(html).toContain('Enterprise Architect');
    expect(html).toContain('Peraton');
    expect(html).toContain('career-responses-waiting');
  });

  it('renders a hidden-company card without leaking the name', () => {
    const applications = [
      application({
        id: 'a1',
        stage: 'saved',
        vacancy: {
          title: 'VP Technology',
          company: '',
          companyHidden: true,
          url: 'https://x',
          source: 'recruiter',
        },
      }),
    ];
    const html = renderToStaticMarkup(<ResponsesBoard state={readyState(applications)} />);

    expect(html).toContain('VP Technology');
    expect(html).toContain('компания скрыта');
  });
});
