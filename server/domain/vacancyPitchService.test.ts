import { describe, expect, it } from 'vitest';
import {
  generateVacancyPitch,
  type VacancyPitchInputFact,
  type VacancyPitchInputVacancy,
} from './vacancyPitchService';

describe('vacancyPitchService', () => {
  const sampleVacancy: VacancyPitchInputVacancy = {
    id: 'vac-101',
    title: 'Lead Backend Engineer',
    company: 'FinTech Platform',
    location: 'Москва',
    isRemote: true,
    requiredSkills: ['TypeScript', 'Node.js', 'PostgreSQL', 'Kafka', 'Kubernetes'],
    responsibilities: ['Проектирование архитектуры платежного шлюза', 'Оптимизация latency p99'],
  };

  const sampleFacts: VacancyPitchInputFact[] = [
    {
      id: 'mem-001',
      statement: 'Спроектировал и запустил платежный шлюз с обработкой 15 000 RPS на Node.js и PostgreSQL',
      domain: 'outcome',
      kind: 'fact',
      sourceMessageIds: ['m1'],
      sensitive: false,
      status: 'confirmed',
    },
    {
      id: 'mem-002',
      statement: 'Снизил p99 задержку микросервисов с 450мс до 80мс через кэширование и тюнинг запросов',
      domain: 'outcome',
      kind: 'fact',
      sourceMessageIds: ['m2'],
      sensitive: false,
      status: 'confirmed',
    },
    {
      id: 'mem-003',
      statement: 'Владею стеком: TypeScript, Node.js, PostgreSQL, Docker, Redis',
      domain: 'skill',
      kind: 'fact',
      sourceMessageIds: ['m3'],
      sensitive: false,
      status: 'confirmed',
    },
    {
      id: 'mem-004',
      statement: 'Управлял инженерной группой из 8 разработчиков в продуктовом финтехе',
      domain: 'responsibility',
      kind: 'fact',
      sourceMessageIds: ['m4'],
      sensitive: false,
      status: 'confirmed',
    },
    {
      id: 'mem-005',
      statement: 'Неподтвержденный факт: работал с Go 5 лет',
      domain: 'skill',
      kind: 'fact',
      sourceMessageIds: ['m5'],
      sensitive: false,
      status: 'proposed',
    },
  ];

  it('synthesizes email pitch with subject, body paragraphs, and used evidence IDs', () => {
    const pitch = generateVacancyPitch({
      vacancy: sampleVacancy,
      candidateName: 'Алексей Денисов',
      facts: sampleFacts,
      tone: 'executive',
      language: 'ru',
    });

    expect(pitch.vacancyId).toBe('vac-101');
    expect(pitch.emailPitch.subject).toContain('Lead Backend Engineer');
    expect(pitch.emailPitch.subject).toContain('Алексей Денисов');
    expect(pitch.emailPitch.body).toContain('FinTech Platform');
    expect(pitch.emailPitch.body).toContain('15 000 RPS');
    expect(pitch.emailPitch.body.split('\n\n').length).toBeGreaterThanOrEqual(3);

    // Only confirmed facts should be in usedEvidenceIds
    expect(pitch.usedEvidenceIds).toContain('mem-001');
    expect(pitch.usedEvidenceIds).not.toContain('mem-005');
    expect(pitch.atsCoverLetter).toContain('Алексей Денисов');
    expect(pitch.atsCoverLetter).toContain('Lead Backend Engineer');
  });

  it('enforces LinkedIn note strictly <= 300 characters across all tones', () => {
    const tones = ['executive', 'confident', 'technical'] as const;

    for (const tone of tones) {
      const pitch = generateVacancyPitch({
        vacancy: sampleVacancy,
        candidateName: 'Алексей Денисов',
        facts: sampleFacts,
        tone,
        language: 'ru',
      });

      expect(pitch.linkedInNote.length).toBeLessThanOrEqual(300);
      expect(pitch.linkedInNote.length).toBeGreaterThan(50);
      expect(pitch.linkedInNote).toContain('Lead Backend Engineer');
    }
  });

  it('handles stack gaps honestly without hallucinating missing skills', () => {
    // Vacancy requires Kafka and Kubernetes, but candidate facts do not have Kafka/K8s
    const pitch = generateVacancyPitch({
      vacancy: sampleVacancy,
      candidateName: 'Алексей Денисов',
      facts: sampleFacts,
      tone: 'technical',
      language: 'ru',
    });

    // Does not claim to be a Kafka/Kubernetes veteran, but cites existing adjacent skills
    expect(pitch.usedEvidenceIds).toContain('mem-003');
    expect(pitch.emailPitch.body).toMatch(/Kafka|Kubernetes/i);
    // Honest coverage gap, without an invented adjacent-fit claim.
    expect(pitch.emailPitch.body).toContain('нет подтверждённых фактов');
  });

  it('adapts phrasing based on selected tone', () => {
    const execPitch = generateVacancyPitch({
      vacancy: sampleVacancy,
      candidateName: 'Алексей Денисов',
      facts: sampleFacts,
      tone: 'executive',
      language: 'ru',
    });

    const techPitch = generateVacancyPitch({
      vacancy: sampleVacancy,
      candidateName: 'Алексей Денисов',
      facts: sampleFacts,
      tone: 'technical',
      language: 'ru',
    });

    const confPitch = generateVacancyPitch({
      vacancy: sampleVacancy,
      candidateName: 'Алексей Денисов',
      facts: sampleFacts,
      tone: 'confident',
      language: 'ru',
    });

    expect(execPitch.emailPitch.body).not.toBe(techPitch.emailPitch.body);
    expect(execPitch.emailPitch.body).not.toBe(confPitch.emailPitch.body);
    expect(techPitch.emailPitch.body).toMatch(/архитектур|стек|инженер|надежност/i);
    expect(execPitch.emailPitch.body).toMatch(/бизнес|управлен|масштаб|процесс/i);
  });

  it('generates clean text with zero emoji and without hidden markers', () => {
    const pitch = generateVacancyPitch({
      vacancy: sampleVacancy,
      candidateName: 'Алексей Денисов',
      facts: sampleFacts,
      language: 'ru',
    });

    const allText = [
      pitch.emailPitch.subject,
      pitch.emailPitch.body,
      pitch.linkedInNote,
      pitch.atsCoverLetter,
    ].join('\n');

    // Zero emoji check
    expect(allText).not.toMatch(/\p{Extended_Pictographic}/u);

    // Zero forbidden word check
    const forbiddenWord = ['\u0434', '\u043E', '\u0441', '\u044C', '\u0435'].join('');
    expect(allText).not.toMatch(new RegExp(forbiddenWord, 'i'));

    // No zero-width or formatting marks
    expect(allText).not.toMatch(/[\u200B-\u200D\uFEFF\u00AD]/);
  });

  it('works gracefully when candidateName is not provided and facts are empty', () => {
    const pitch = generateVacancyPitch({
      vacancy: { id: 'vac-empty', title: 'Product Designer' },
      facts: [],
    });

    expect(pitch.vacancyId).toBe('vac-empty');
    expect(pitch.emailPitch.subject).toContain('Product Designer');
    expect(pitch.linkedInNote.length).toBeLessThanOrEqual(300);
    expect(pitch.usedEvidenceIds).toEqual([]);
    expect(pitch.atsCoverLetter).toBeTruthy();
  });

  it('does not invent adjacent fit or measured experience for an empty or negative dossier', () => {
    const empty = generateVacancyPitch({
      vacancy: { id: 'vac-empty', title: 'Бухгалтер', requiredSkills: ['Excel'] },
      facts: [],
    });
    expect(empty.emailPitch.body).toContain('нет подтверждённых фактов');
    expect(empty.emailPitch.body).not.toContain('смежный фундамент');
    expect(empty.emailPitch.body).not.toContain('быстрому освоению');

    const negative = generateVacancyPitch({
      vacancy: { id: 'vac-negative', title: 'Бухгалтер', requiredSkills: ['Excel'] },
      facts: [
        {
          id: 'negative-excel',
          statement: 'Не имею опыта работы с Excel',
          domain: 'skill',
          kind: 'fact',
          sourceMessageIds: ['m-negative'],
          sensitive: false,
          status: 'confirmed',
        },
      ],
    });
    expect(negative.emailPitch.body).not.toContain('подтверждён практический опыт работы со стеком: Excel');
    expect(negative.usedEvidenceIds).toEqual([]);
  });

  it('never turns sensitive or unproven memories into external copy', () => {
    const pitch = generateVacancyPitch({
      vacancy: { id: 'vac-sensitive', title: 'Product Manager' },
      facts: [
        {
          id: 'private',
          statement: 'PRIVATE_SYNTHETIC_HEALTH_FACT',
          domain: 'fact',
          kind: 'fact',
          sourceMessageIds: ['m-private'],
          sensitive: true,
          status: 'confirmed',
        },
        {
          id: 'hypothesis',
          statement: 'Предполагаемый опыт в стратегии',
          domain: 'skill',
          kind: 'hypothesis',
          sourceMessageIds: ['m-hypothesis'],
          sensitive: false,
          status: 'confirmed',
        },
      ],
    });
    const text = `${pitch.emailPitch.body}\n${pitch.linkedInNote}\n${pitch.atsCoverLetter}`;
    expect(text).not.toContain('PRIVATE_SYNTHETIC_HEALTH_FACT');
    expect(text).not.toContain('Предполагаемый опыт');
    expect(pitch.usedEvidenceIds).toEqual([]);
  });

  it('writes in English for an English-language vacancy detected from its own text', () => {
    const pitch = generateVacancyPitch({
      vacancy: {
        id: 'vac-en',
        title: 'Senior Platform Engineer',
        company: 'Acme Corp',
        description: 'We are hiring a senior engineer to own our payments platform.',
        requiredSkills: ['Go', 'Kubernetes'],
      },
      candidateName: 'Alexey Denisov',
      facts: sampleFacts,
    });

    expect(pitch.language).toBe('en');
    expect(pitch.emailPitch.body).toMatch(/Hello!/);
    expect(pitch.emailPitch.body).not.toMatch(/Здравствуйте/);
  });

  it('detects Russian from vacancy text even when the title is transliterated Latin', () => {
    const pitch = generateVacancyPitch({
      vacancy: {
        id: 'vac-ru-desc',
        title: 'Backend Engineer',
        description: 'Ищем инженера для команды платежей.',
      },
      facts: [],
    });
    expect(pitch.language).toBe('ru');
  });

  it('uses imported (proposed) facts from the candidate profile when there are zero confirmed facts', () => {
    const importedOnly: VacancyPitchInputFact[] = [
      {
        id: 'imp-001',
        statement: 'Спроектировал и запустил платежный шлюз с обработкой 15 000 RPS',
        domain: 'outcome',
        kind: 'fact',
        sourceMessageIds: ['resume-import-1'],
        sensitive: false,
        status: 'proposed',
      },
    ];

    const pitch = generateVacancyPitch({
      vacancy: sampleVacancy,
      candidateName: 'Алексей Денисов',
      facts: importedOnly,
      language: 'ru',
    });

    expect(pitch.usedEvidenceIds).toContain('imp-001');
    expect(pitch.usedFacts).toContainEqual({ id: 'imp-001', basis: 'imported' });
    expect(pitch.emailPitch.body).toContain('15 000 RPS');
  });

  it('never puts a service phrase about missing facts or unmatched requirements into the letter body, on any path', () => {
    const noFacts = generateVacancyPitch({
      vacancy: { id: 'vac-no-facts', title: 'Бухгалтер', requiredSkills: ['Excel'] },
      facts: [],
    });
    const serviceMarkers = [
      'не выбраны',
      'не сопоставлены с подтверждёнными',
      'not selected',
      'have not been matched',
    ];
    for (const marker of serviceMarkers) {
      expect(noFacts.emailPitch.body).not.toContain(marker);
      expect(noFacts.atsCoverLetter).not.toContain(marker);
    }
    expect(noFacts.notices.length).toBeGreaterThan(0);
  });
});
