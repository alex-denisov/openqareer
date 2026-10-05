import { describe, expect, it } from 'vitest';
import { collectDraftFacts } from './draftFacts';

const resume = {
  candidate: {},
  targetRole: 'CTO',
  experience: [
    {
      id: 'e1',
      chronologyMemoryId: 'm',
      title: 'VP Engineering',
      employer: 'Acme',
      startDate: '2021-03',
      current: true,
      bulletMemoryIds: [],
    },
    {
      id: 'e2',
      chronologyMemoryId: 'm',
      title: 'Head of Data',
      employer: 'Beta',
      startDate: '2018-01',
      endDate: '2021-02',
      current: false,
      bulletMemoryIds: [],
    },
    {
      id: 'e3',
      chronologyMemoryId: 'm',
      employer: 'Без должности',
      current: false,
      bulletMemoryIds: [],
    },
  ],
  skills: [
    { id: 's1', name: 'Kafka' },
    { id: 's2', name: 'Kubernetes' },
  ],
  education: [],
  languages: [],
};

describe('collectDraftFacts', () => {
  it('ставит подтверждённые факты памяти первыми и не берёт предложенные', () => {
    const facts = collectDraftFacts({
      memory: [
        { id: 'a', status: 'proposed', statement: 'догадка' },
        { id: 'b', status: 'confirmed', statement: 'Запустил платформу данных' },
      ],
      resume: null,
    });
    expect(facts).toEqual([{ ref: 'b', statement: 'Запустил платформу данных' }]);
  });

  // Прод 05.10: у adenisov.test 1 непроверенный факт и 6 мест работы в резюме — черновики выходили общими.
  it('добавляет из резюме целевую роль, опыт с должностью и навыки', () => {
    const facts = collectDraftFacts({ memory: [], resume: { draft: resume } });
    expect(facts.map((fact) => fact.statement)).toEqual([
      'Целевая роль: CTO',
      'VP Engineering — Acme (2021-03 — по настоящее время)',
      'Head of Data — Beta (2018-01 — 2021-02)',
      'Навыки: Kafka, Kubernetes',
    ]);
    expect(facts[1]?.ref).toBe('resume:experience:e1');
  });

  it('отдаёт не больше 7 фактов', () => {
    const memory = Array.from({ length: 9 }, (_, index) => ({
      id: `m${index}`,
      status: 'confirmed',
      statement: `факт ${index}`,
    }));
    expect(collectDraftFacts({ memory, resume: { draft: resume } })).toHaveLength(7);
  });
});
