import { describe, expect, it } from 'vitest';
import type { ProposedRole } from '../../../shared/roleProposals';
import { mapProposedRoleToCareerRole, summarizeRolesMarket } from './roleHypothesisAdapter';

function observed(
  overrides: Partial<Extract<ProposedRole['confirmation'], { state: 'observed' }>> = {},
): ProposedRole {
  return {
    id: 'role-director-engineering',
    title: 'Director of Engineering',
    origin: 'model',
    reason: 'вёл платформу',
    evidenceRefs: ['memory:1'],
    family: null,
    confirmation: {
      state: 'observed',
      sampleSize: 88,
      observedFrom: '2026-09-20T08:00:00.000Z',
      observedTo: '2026-10-05T08:00:00.000Z',
      sources: [
        { source: 'hh', count: 60 },
        { source: 'linkedin', count: 28 },
      ],
      repeatedRequirements: ['Платёжные системы', 'Kafka'],
      matchedRequirements: 1,
      matchedRequirementNames: ['Платёжные системы'],
      wage: { sampleSize: 88, min: 600_000, max: 780_000 },
      ...overrides,
    },
  };
}

describe('mapProposedRoleToCareerRole (B445)', () => {
  it('берёт вилку из вакансий с зарплатой, а не из константы', () => {
    const role = mapProposedRoleToCareerRole(observed(), {
      acceptedTitle: null,
      offersDismissed: [],
    });
    expect(role.wageDisplay).toBe('600–780 тыс. ₽');
    expect(role.wageSampleNote).toBeNull();
    expect(role.observedDate).toBe('05.10');
    expect(role.sources).toEqual(['hh.ru', 'LinkedIn']);
  });

  it('подписывает выборку вилки, когда зарплата указана не у всех', () => {
    const role = mapProposedRoleToCareerRole(
      observed({ sampleSize: 312, wage: { sampleSize: 94, min: 420_000, max: 560_000 } }),
      { acceptedTitle: null, offersDismissed: [] },
    );
    expect(role.wageSampleNote).toBe('вилка по 94 вакансиям с зарплатой');
  });

  it('не считает вилку ниже порога и без данных о зарплате', () => {
    const few = mapProposedRoleToCareerRole(observed({ wage: { sampleSize: 3, min: 1, max: 2 } }), {
      acceptedTitle: null,
      offersDismissed: [],
    });
    const none = mapProposedRoleToCareerRole(observed({ wage: undefined }), {
      acceptedTitle: null,
      offersDismissed: [],
    });
    expect(few.wageDisplay).toBe('вилка не считается');
    expect(none.wageDisplay).toBe('вилка не считается');
    expect(none.wageDisplay).not.toContain('450');
  });

  it('подтверждает только совпавшие требования, остальное — чего не хватает', () => {
    const role = mapProposedRoleToCareerRole(observed(), {
      acceptedTitle: null,
      offersDismissed: [],
    });
    expect(role.status).toBe('skills_checked');
    expect(role.confirmedItems).toEqual([{ text: 'Платёжные системы', source: 'profile' }]);
    expect(role.missingItems.map((item) => item.text)).toEqual(['Kafka']);
    expect(role.requirementsNote).toBe('Сверка с требованиями 88 вакансий, 05.10.');
    expect(role.nextAction.action).toBe('fill_with_consultant');
  });

  it('роль открыта для поиска только по решению кандидата', () => {
    const role = mapProposedRoleToCareerRole(observed(), {
      acceptedTitle: 'director of engineering',
      offersDismissed: [],
    });
    expect(role.status).toBe('open_for_search');
    expect(role.nextAction.action).toBe('open_vacancies');
  });

  it('завершённая проверка навыков роли переводит её в «Навыки проверены»', () => {
    const unchecked = observed({ matchedRequirements: 0, matchedRequirementNames: [] });
    expect(
      mapProposedRoleToCareerRole(unchecked, { acceptedTitle: null, offersDismissed: [] }).status,
    ).toBe('hypothesis');
    const checked = mapProposedRoleToCareerRole(unchecked, {
      acceptedTitle: null,
      offersDismissed: [],
      checkedTitles: ['director of engineering'],
    });
    expect(checked.status).toBe('skills_checked');
  });

  it('B565: «Подтверждено» у проверенной роли — навыки, подтверждённые проверкой', () => {
    const unchecked = observed({ matchedRequirements: 0, matchedRequirementNames: [] });
    const role = mapProposedRoleToCareerRole(unchecked, {
      acceptedTitle: null,
      offersDismissed: [],
      checkedTitles: ['director of engineering'],
      checkedSkills: { 'director of engineering': ['Найм', 'Бюджет'] },
    });
    expect(role.confirmedItems).toEqual([
      { text: 'Найм', source: 'check' },
      { text: 'Бюджет', source: 'check' },
    ]);
  });

  it('роль без вакансий — гипотеза без чисел и без даты', () => {
    const role = mapProposedRoleToCareerRole(
      { ...observed(), confirmation: { state: 'not-found' } },
      { acceptedTitle: null, offersDismissed: ['role-director-engineering'] },
    );
    expect(role.status).toBe('hypothesis');
    expect(role.observedDate).toBeNull();
    expect(role.vacancyCount).toBe(0);
    expect(role.requirementsNote).toContain('не сверены');
    expect(role.nextAction.action).toBe('few_data');
    expect(role.offerDismissed).toBe(true);
  });
});

describe('summarizeRolesMarket (B445)', () => {
  it('без наблюдаемых ролей берёт дату и площадки из выборки сервера', () => {
    const tooFew = mapProposedRoleToCareerRole(
      { ...observed(), confirmation: { state: 'too-few', sampleSize: 2 } },
      { acceptedTitle: null, offersDismissed: [] },
    );
    expect(
      summarizeRolesMarket([tooFew], {
        observedAt: '2026-10-21T09:00:00.000Z',
        sources: ['hh_search', 'linkedin'],
      }),
    ).toEqual({ vacancyTotal: 2, asOf: '21.10', sources: ['hh.ru', 'LinkedIn'] });
  });

  it('складывает вакансии ролей, берёт последнюю дату и площадки', () => {
    const a = mapProposedRoleToCareerRole(observed(), { acceptedTitle: null, offersDismissed: [] });
    const b = mapProposedRoleToCareerRole(
      observed({
        sampleSize: 12,
        observedTo: '2026-10-07T08:00:00.000Z',
        sources: [{ source: 'hh', count: 12 }],
      }),
      { acceptedTitle: null, offersDismissed: [] },
    );
    expect(summarizeRolesMarket([a, b])).toEqual({
      vacancyTotal: 100,
      asOf: '07.10',
      sources: ['hh.ru', 'LinkedIn'],
    });
  });

  it('пустые роли дают пустую сводку без даты', () => {
    expect(summarizeRolesMarket([])).toEqual({ vacancyTotal: 0, asOf: null, sources: [] });
  });
});

describe('роль, которая уже есть у кандидата, не предлагается (26.10)', () => {
  const base = { acceptedTitle: null, offersDismissed: [] };

  it('роль с проверенными навыками — уже роль кандидата, под любым её названием', () => {
    const role = mapProposedRoleToCareerRole(
      {
        ...observed(),
        title: 'Операционный директор (COO)',
        aliases: ['Операционный директор (COO)', 'Chief Operating Officer'],
      },
      { ...base, checkedTitles: ['Chief Operating Officer'] },
    );
    expect(role.status).toBe('skills_checked');
    expect(role.alreadyChosen).toBe(true);
  });

  it('роль, выбранная в мастере или принятая, — уже роль кандидата', () => {
    expect(
      mapProposedRoleToCareerRole({ ...observed(), origin: 'candidate' }, base).alreadyChosen,
    ).toBe(true);
    expect(
      mapProposedRoleToCareerRole(observed(), { ...base, acceptedTitle: 'Director of Engineering' })
        .alreadyChosen,
    ).toBe(true);
  });

  it('роль, которую подтвердил только рынок, ещё можно предложить', () => {
    expect(mapProposedRoleToCareerRole(observed(), base).alreadyChosen).toBe(false);
  });
});
