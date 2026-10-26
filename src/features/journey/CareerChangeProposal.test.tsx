import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { careerRoleId } from '../../../shared/roleProposals';
import { CareerChangeProposal, roleChangeAlreadyApplied } from './CareerChangeProposal';
import { describeCareerChange } from './careerChangeApply';
import { CareerActionProposalList } from './CareerCommandActions';
import { careerChangeKey, resetCareerChangeDismissals } from './careerChangeDismissals';

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

  it('убранная роль после перезагрузки показана применённой, а не предложена снова', () => {
    const change = proposal.careerChange;
    const id = careerRoleId(change.roleTitle);
    const ready = { status: 'ready' as const, roles: [], rejected: [id] };
    expect(roleChangeAlreadyApplied('career.role.remove', change, ready)).toBe(true);
    expect(roleChangeAlreadyApplied('career.role.remove', change, { ...ready, rejected: [] })).toBe(false);
    expect(roleChangeAlreadyApplied('career.role.remove', change, { ...ready, status: 'idle' })).toBe(false);
  });

  it('отложенное «Не сейчас» предложение после перезагрузки не показывается', () => {
    const lines = describeCareerChange('career.role.remove', proposal.careerChange);
    resetCareerChangeDismissals([careerChangeKey('career.role.remove', lines)]);
    const html = renderToStaticMarkup(
      <CareerChangeProposal proposal={proposal} kind="career.role.remove" />,
    );
    expect(html).toBe('');
    resetCareerChangeDismissals();
  });

  it('список без единого видимого предложения не рисует заголовок «Следующие задания»', () => {
    const lines = describeCareerChange('career.role.remove', proposal.careerChange);
    resetCareerChangeDismissals([careerChangeKey('career.role.remove', lines)]);
    const html = renderToStaticMarkup(<CareerActionProposalList proposals={[proposal]} />);
    expect(html).not.toContain('Следующие задания');
    resetCareerChangeDismissals();
  });
});
