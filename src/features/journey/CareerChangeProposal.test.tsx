import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CareerChangeProposal } from './CareerChangeProposal';

const proposal = {
  kind: 'career.role.remove' as const,
  objective: 'Вы сказали, что производство вам не интересно.',
  evidenceRefs: ['msg-1'],
  acceptanceCriteria: ['Роль ушла из «Карьеры»'],
  expectedSignal: 'В подборке нет производственных директоров',
  measureAfter: '2026-11-02',
  risk: 'candidate_data_write' as const,
  resumeRevision: null,
  careerChange: {
    roleTitle: 'Производственный директор',
    locations: null,
    salaryFloorRubles: null,
    formats: null,
    relocation: null,
    stopCompanies: null,
  },
};

describe('CareerChangeProposal (26.10)', () => {
  it('показывает, что изменится, и ждёт подтверждения кандидата', () => {
    const html = renderToStaticMarkup(
      <CareerChangeProposal proposal={proposal} kind="career.role.remove" />,
    );
    expect(html).toContain('Убрать роль из «Карьеры»');
    expect(html).toContain('Роль: Производственный директор');
    expect(html).toContain('Применить');
    expect(html).toContain('Не сейчас');
  });
});
