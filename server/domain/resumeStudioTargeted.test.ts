import { describe, expect, it } from 'vitest';
import { buildTargetedResumeSlice } from './resumeStudio';
import type { ResumeAssertion, ResumeDocument } from './resumeStudio';

const fact = <Value extends string | boolean = string>(
  value: Value,
  memoryId: string,
): ResumeAssertion<Value> => ({
  value,
  memoryId,
  sourceMessageIds: [`message-${memoryId}`],
  reviewFlags: [],
});

const master: ResumeDocument = {
  kind: 'master',
  targetRole: 'Инженер-программист',
  contact: {
    fullName: 'Анна Пример',
    email: 'anna@example.test',
    phone: null,
    location: 'Москва',
    links: [],
  },
  about: 'Инженер платформы с опытом эксплуатации сервисов.',
  experience: [
    {
      id: 'operations',
      title: fact('Инженер эксплуатации', 'role-operations'),
      employer: fact('Example Systems', 'role-operations'),
      location: null,
      startDate: fact('2019', 'role-operations'),
      endDate: fact('2021', 'role-operations'),
      current: fact(false, 'role-operations'),
      bullets: [fact('Поддерживала PostgreSQL в production.', 'ops-postgres')],
    },
    {
      id: 'platform',
      title: fact('Инженер платформы', 'role-platform'),
      employer: fact('Example Cloud', 'role-platform'),
      location: null,
      startDate: fact('2022', 'role-platform'),
      endDate: null,
      current: fact(true, 'role-platform'),
      bullets: [
        fact('Автоматизировала развёртывание Kubernetes-сервисов.', 'platform-k8s'),
        fact('Сократила время восстановления сервисов.', 'platform-recovery'),
      ],
    },
    {
      id: 'sales',
      title: fact('Менеджер продаж', 'role-sales'),
      employer: fact('Example Retail', 'role-sales'),
      location: null,
      startDate: fact('2016', 'role-sales'),
      endDate: fact('2018', 'role-sales'),
      current: fact(false, 'role-sales'),
      bullets: [fact('Вела переговоры с партнёрами.', 'sales-partners')],
    },
  ],
  projects: [
    {
      id: 'cluster-migration',
      name: fact('Миграция Kubernetes-кластера', 'project-k8s'),
      description: fact('Перенос внутренних сервисов без простоя.', 'project-k8s'),
      employer: null,
      startDate: null,
      endDate: null,
      current: null,
      url: null,
      skills: [fact('Kubernetes', 'project-k8s')],
    },
    {
      id: 'internal-newsletter',
      name: fact('Внутренняя рассылка', 'project-newsletter'),
      description: fact('Запустила рассылку для команды.', 'project-newsletter'),
      employer: null,
      startDate: null,
      endDate: null,
      current: null,
      url: null,
      skills: [],
    },
  ],
  skills: [
    { id: 'kubernetes', name: 'Kubernetes' },
    { id: 'postgresql', name: 'PostgreSQL' },
  ],
  education: [],
  languages: [],
  unknowns: [],
  conventions: {
    country: null,
    packVersion: null,
    reverseChronological: false,
    maxPages: null,
    recommendedBulletsPerRole: null,
    photo: 'omitted',
    discriminatoryPii: 'omitted',
  },
  length: { lines: 30, pages: 1, linesPerPage: 45 },
};

function assertionValues(document: ResumeDocument): string[] {
  return [
    ...document.experience.flatMap((role) => [
      role.title?.value,
      role.employer?.value,
      role.location?.value,
      role.startDate?.value,
      role.endDate?.value,
      ...role.bullets.map((bullet) => bullet.value),
    ]),
    ...(document.projects ?? []).flatMap((project) => [
      project.name.value,
      project.description?.value,
      project.employer?.value,
      ...project.skills.map((skill) => skill.value),
    ]),
    ...document.education.flatMap((item) => [
      item.institution?.value,
      item.qualification?.value,
      item.startDate?.value,
      item.endDate?.value,
    ]),
    ...document.languages.flatMap((item) => [item.name?.value, item.cefr?.value]),
  ].filter((value): value is string => Boolean(value));
}

function documentFacts(document: ResumeDocument): string[] {
  return [
    document.about,
    document.contact.fullName,
    document.contact.email,
    document.contact.phone,
    document.contact.telegram,
    document.contact.location,
    ...(document.contact.links ?? []),
    ...(document.skills ?? []).map((skill) => skill.name),
    ...(document.courses ?? []).map((course) => course.name),
    ...(document.tests ?? []).map((test) => test.name),
    ...(document.recommendations ?? []).flatMap((item) => [item.text, item.author, item.recommender]),
    ...Object.values(document.additional ?? {}),
    ...assertionValues(document),
  ].filter((value): value is string => Boolean(value));
}

describe('buildTargetedResumeSlice', () => {
  it('prioritizes supported facts, compresses other roles, and keeps unsupported requirements visible', () => {
    const result = buildTargetedResumeSlice(master, {
      title: 'Инженер платформы',
      requirements: ['Kubernetes', 'PostgreSQL', 'GraphQL'],
    });

    expect(result.document.experience.map((role) => role.id)).toEqual([
      'platform',
      'operations',
      'sales',
    ]);
    expect(result.document.experience[0]?.bullets).toEqual(master.experience[1]?.bullets);
    expect(result.document.experience[1]?.bullets).toEqual(master.experience[0]?.bullets);
    expect(result.document.experience[2]?.bullets).toEqual([]);
    expect(result.document.projects?.map((project) => project.id)).toEqual([
      'cluster-migration',
    ]);
    expect(result.document.skills?.map((skill) => skill.name)).toEqual([
      'Kubernetes',
      'PostgreSQL',
    ]);
    expect(result.matchedRequirements).toEqual(['Kubernetes', 'PostgreSQL']);
    expect(result.missingRequirements).toEqual(['GraphQL']);
    expect(result.estimatedPages).toBeGreaterThanOrEqual(1);
    expect(result.estimatedPages).toBeLessThanOrEqual(2);

    const masterValues = new Set(documentFacts(master));
    expect(documentFacts(result.document).every((value) => masterValues.has(value))).toBe(true);
  });
});
