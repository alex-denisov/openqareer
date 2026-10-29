import type { ProposedRole } from '../../../shared/roleProposals';
import type { CareerRoleModel, SearchConditionsDraft } from './careerScreenTypes';
import { mapProposedRolesToCareerRoles } from './roleHypothesisAdapter';

/**
 * Синтетические роли для CLI-рендера макета и тестов — не для рабочего
 * экрана: он читает роли только с сервера (B445).
 */
function observedRole(input: {
  id: string;
  title: string;
  sampleSize: number;
  requirements: string[];
  matched: string[];
  wage?: { sampleSize: number; min?: number; max?: number };
  reason?: string;
}): ProposedRole {
  return {
    id: input.id,
    title: input.title,
    origin: 'model',
    reason: input.reason ?? 'опыт руководства разработкой платёжной платформы',
    evidenceRefs: ['memory:fixture'],
    family: null,
    confirmation: {
      state: 'observed',
      sampleSize: input.sampleSize,
      observedFrom: '2026-09-20T08:00:00.000Z',
      observedTo: '2026-10-05T08:00:00.000Z',
      sources: [
        { source: 'hh', count: Math.ceil(input.sampleSize * 0.7) },
        { source: 'linkedin', count: Math.floor(input.sampleSize * 0.3) },
      ],
      repeatedRequirements: input.requirements,
      matchedRequirements: input.matched.length,
      matchedRequirementNames: input.matched,
      ...(input.wage ? { wage: input.wage } : {}),
    },
  };
}

export const CAREER_FIXTURE_PROPOSED_ROLES: readonly ProposedRole[] = [
  observedRole({
    id: 'role-director-engineering',
    title: 'Director of Engineering',
    sampleSize: 88,
    requirements: ['Платёжные системы', 'Бюджет разработки', 'Kafka'],
    matched: ['Платёжные системы'],
    wage: { sampleSize: 88, min: 600_000, max: 780_000 },
  }),
  observedRole({
    id: 'role-engineering-head',
    title: 'Head of Engineering',
    sampleSize: 312,
    requirements: ['Управление командами', 'Найм'],
    matched: ['Управление командами', 'Найм'],
    wage: { sampleSize: 94, min: 420_000, max: 560_000 },
  }),
  observedRole({
    id: 'role-cto-финтехе',
    title: 'CTO в финтехе',
    sampleSize: 41,
    requirements: ['Совет директоров', 'Регуляторика ЦБ'],
    matched: [],
    wage: { sampleSize: 41, min: 650_000, max: 900_000 },
    reason: 'платёжные системы в опыте совпадают с типичными требованиями к CTO в финтехе',
  }),
  {
    id: 'role-engineering-vp',
    title: 'VP Engineering',
    origin: 'model',
    reason: 'руководил несколькими командами',
    evidenceRefs: ['memory:fixture'],
    family: null,
    confirmation: { state: 'too-few', sampleSize: 4 },
  },
];

export const DEFAULT_MOCK_ROLES: readonly CareerRoleModel[] = mapProposedRolesToCareerRoles(
  CAREER_FIXTURE_PROPOSED_ROLES,
  {
    acceptedTitle: 'Head of Engineering',
    offersDismissed: [],
    checkedTitles: ['Director of Engineering', 'Head of Engineering'],
  },
);

export const DEFAULT_SEARCH_CONDITIONS: SearchConditionsDraft = {
  geography: { selected: ['Москва', 'удалённо из РФ'], isRelocationEnabled: false },
  salaryFrom: { amountRubles: 450_000, showWithoutSalary: true },
  format: { office: false, hybrid: true, remote: true },
  stopList: [
    { id: 'a', name: 'Альфа', origin: 'добавлено вручную' },
    { id: 'b', name: 'Бета', origin: 'добавлено вручную' },
  ],
};
