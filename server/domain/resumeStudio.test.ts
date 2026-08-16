import { describe, expect, it } from 'vitest';
import { resumeDraftSchema, EMPTY_RESUME_DRAFT } from './resumeDraft';
import {
  buildResumeStudioProjection,
  validateResumeEvidenceFreshness,
  type ResumeAssertion,
  type ResumeDocument,
  type ResumeEvidence,
  type ResumeStudioInput,
} from './resumeStudio';

const evidence = (
  id: string,
  statement: string,
  overrides: Partial<ResumeEvidence> = {},
): ResumeEvidence => ({
  id,
  kind: 'fact',
  status: 'confirmed',
  statement,
  sourceMessageIds: [`message-${id}`],
  sensitive: false,
  ...overrides,
});

const confirmedEvidence: ResumeEvidence[] = [
  evidence('role-current', 'Подтверждена текущая роль в Example GmbH.'),
  evidence(
    'outcome-current',
    'Сократила цикл поставки на 30% без сокращения контрольных проверок.',
  ),
  evidence('role-earlier', 'Подтверждена предыдущая роль в Earlier AG.'),
  evidence(
    'outcome-earlier',
    'Запустила операционный контур для первых десяти клиентов.',
    { status: 'corrected' },
  ),
  evidence('education', 'Окончила Example University по программе MBA.'),
  evidence('language-de', 'Кандидат подтвердил немецкий язык на уровне B2.'),
  evidence('proposed-claim', 'Возможно, удвоила выручку.', {
    status: 'proposed',
  }),
  evidence('sensitive-claim', 'Содержит чувствительные персональные сведения.', {
    sensitive: true,
  }),
  evidence('preference', 'Предпочитает гибридный формат работы.', {
    kind: 'preference',
  }),
];

const candidateWithForbiddenPii = {
  fullName: 'Mila Example',
  contact: {
    email: 'mila@example.test',
    phone: '+49 000 000000',
    location: 'Berlin',
    links: ['https://example.test/mila'],
  },
  photo: 'forbidden-photo-bytes',
  birthDate: '1990-01-01',
  birthPlace: 'Forbidden Birth Place',
  maritalStatus: 'Forbidden Marital Status',
  religion: 'Forbidden Religion',
};

const completeInput = (): ResumeStudioInput => ({
  candidate: candidateWithForbiddenPii,
  evidence: confirmedEvidence,
  targetRole: 'VP Technology & Operations',
  experience: [
    {
      id: 'earlier-role',
      chronologyMemoryId: 'role-earlier',
      title: 'Operations Lead',
      employer: 'Earlier AG',
      startDate: '2018-01',
      endDate: '2021-12',
      current: false,
      bulletMemoryIds: ['outcome-earlier'],
    },
    {
      id: 'current-role',
      chronologyMemoryId: 'role-current',
      title: 'Technology & Operations Director',
      employer: 'Example GmbH',
      location: 'Berlin',
      startDate: '2022-01',
      current: true,
      bulletMemoryIds: [
        'outcome-current',
        'proposed-claim',
        'sensitive-claim',
        'preference',
      ],
    },
  ],
  education: [
    {
      id: 'mba',
      evidenceMemoryId: 'education',
      institution: 'Example University',
      qualification: 'MBA',
      endDate: '2017-06',
    },
  ],
  languages: [
    {
      id: 'german',
      evidenceMemoryId: 'language-de',
      name: 'Deutsch',
      cefr: 'B2',
    },
  ],
});

describe('Resume Studio canonical projection', () => {
  it('builds master and Germany role variants only from confirmed factual evidence', () => {
    const projection = buildResumeStudioProjection(completeInput());

    expect(projection.master.experience.map((role) => role.id)).toEqual([
      'earlier-role',
      'current-role',
    ]);
    expect(projection.germanyVariant.experience.map((role) => role.id)).toEqual([
      'current-role',
      'earlier-role',
    ]);
    expect(projection.germanyVariant.targetRole).toBe(
      'VP Technology & Operations',
    );
    expect(projection.germanyVariant.conventions).toMatchObject({
      country: 'DE',
      packVersion: 'DE-CV-2026.1',
      reverseChronological: true,
      maxPages: 2,
      photo: 'omitted',
      discriminatoryPii: 'omitted',
    });

    const assertions = assertionsIn(projection.germanyVariant);
    expect(assertions.length).toBeGreaterThan(0);
    expect(
      assertions.every(
        (assertion) =>
          assertion.memoryId.length > 0 &&
          assertion.sourceMessageIds.length > 0,
      ),
    ).toBe(true);
    expect(assertions.map((assertion) => assertion.memoryId)).toContain(
      'outcome-earlier',
    );
    expect(assertions.map((assertion) => assertion.memoryId)).not.toEqual(
      expect.arrayContaining([
        'proposed-claim',
        'sensitive-claim',
        'preference',
      ]),
    );
    expect(projection.excludedEvidenceIds).toEqual(
      expect.arrayContaining([
        'proposed-claim',
        'sensitive-claim',
        'preference',
      ]),
    );
    expect(
      projection.germanyVariant.experience[0]?.bullets[0]?.reviewFlags,
    ).toContain('quantitative-claim-needs-substantiation');

    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain('forbidden-photo-bytes');
    expect(serialized).not.toContain('1990-01-01');
    expect(serialized).not.toContain('Forbidden Birth Place');
    expect(serialized).not.toContain('Forbidden Marital Status');
    expect(serialized).not.toContain('Forbidden Religion');
  });

  it('keeps missing identity, contact, chronology, education and CEFR explicit', () => {
    const projection = buildResumeStudioProjection({
      candidate: {},
      evidence: [
        evidence('role-conflict', 'Подтверждена роль с датами для проверки.'),
        evidence('language', 'Кандидат указал немецкий язык.'),
      ],
      targetRole: '   ',
      experience: [
        {
          id: 'conflicting-role',
          chronologyMemoryId: 'role-conflict',
          title: '',
          employer: '',
          startDate: '2025-01',
          endDate: '2024-01',
          current: false,
          bulletMemoryIds: [],
        },
      ],
      education: [],
      languages: [
        {
          id: 'german',
          evidenceMemoryId: 'language',
          name: 'Deutsch',
          cefr: 'B3' as ResumeStudioInput['languages'][number]['cefr'],
        },
      ],
    });

    const masterUnknowns = projection.master.unknowns.map((item) => item.code);
    expect(masterUnknowns).toEqual(
      expect.arrayContaining([
        'missing-full-name',
        'missing-contact',
        'missing-role-title',
        'missing-employer',
        'missing-role-claims',
        'missing-education',
        'missing-language-level',
        'chronology-conflict',
      ]),
    );
    expect(
      projection.germanyVariant.unknowns.map((item) => item.code),
    ).toContain('missing-target-role');
    expect(projection.master.languages[0]?.cefr).toBeNull();
    expect(JSON.stringify(projection)).not.toContain('B3');
  });
});

describe('Resume Studio country conventions', () => {
  it('reports a Germany variant longer than two pages without dropping confirmed facts', () => {
    const longCareer = Array.from({ length: 6 }, (_, roleIndex) => ({
      chronology: evidence(
        `role-${roleIndex}`,
        `Подтверждена роль номер ${roleIndex}.`,
      ),
      bullets: Array.from({ length: 5 }, (_, bulletIndex) =>
        evidence(
          `bullet-${roleIndex}-${bulletIndex}`,
          `Подтверждённый результат: ${'детали ответственности и наблюдаемого эффекта '.repeat(5)}`,
        ),
      ),
    }));
    const projection = buildResumeStudioProjection({
      ...completeInput(),
      evidence: [
        ...confirmedEvidence,
        ...longCareer.flatMap((role) => [role.chronology, ...role.bullets]),
      ],
      experience: longCareer.map((role, index) => ({
        id: `role-${index}`,
        chronologyMemoryId: role.chronology.id,
        title: `Operations Director ${index}`,
        employer: `Example ${index} GmbH`,
        startDate: `20${10 + index * 2}-01`,
        endDate: `20${12 + index * 2}-01`,
        current: false,
        bulletMemoryIds: role.bullets.map((item) => item.id),
      })),
    });

    expect(projection.germanyVariant.length.pages).toBeGreaterThan(2);
    expect(
      projection.germanyVariant.unknowns.filter(
        (item) => item.code === 'germany-length-exceeds-two-pages',
      ),
    ).toEqual([
      expect.objectContaining({ scope: 'DE', blocking: true }),
    ]);
    expect(
      projection.master.unknowns.some(
        (item) => item.code === 'germany-length-exceeds-two-pages',
      ),
    ).toBe(false);
    expect(
      projection.germanyVariant.experience.flatMap((role) => role.bullets),
    ).toHaveLength(30);
  });

  it('keeps a short Germany variant inside two pages and warns outside three to five bullets', () => {
    const projection = buildResumeStudioProjection(completeInput());

    expect(projection.germanyVariant.length).toMatchObject({
      pages: 1,
      linesPerPage: 45,
    });
    expect(
      projection.germanyVariant.unknowns.some(
        (item) => item.code === 'germany-length-exceeds-two-pages',
      ),
    ).toBe(false);
    expect(
      projection.germanyVariant.unknowns.filter(
        (item) => item.code === 'germany-bullet-count',
      ),
    ).toEqual([
      expect.objectContaining({ scope: 'DE', blocking: false, entryId: 'current-role' }),
      expect.objectContaining({ scope: 'DE', blocking: false, entryId: 'earlier-role' }),
    ]);
  });
});

describe('Resume Studio claim discipline', () => {
  it('never copies vacancy language and reproduces confirmed statements verbatim', () => {
    const vacancyDuty = evidence(
      'vacancy-duty',
      'Из вакансии: обеспечивать полный цикл поставки и управлять командой 50 человек.',
      { kind: 'hypothesis' },
    );
    const projection = buildResumeStudioProjection({
      ...completeInput(),
      evidence: [...confirmedEvidence, vacancyDuty],
      experience: [
        {
          id: 'current-role',
          chronologyMemoryId: 'role-current',
          title: 'Technology & Operations Director',
          employer: 'Example GmbH',
          startDate: '2022-01',
          current: true,
          bulletMemoryIds: ['outcome-current', 'vacancy-duty'],
        },
      ],
    });

    const bullets = projection.germanyVariant.experience.flatMap(
      (role) => role.bullets,
    );
    expect(bullets.map((bullet) => bullet.value)).toEqual([
      'Сократила цикл поставки на 30% без сокращения контрольных проверок.',
    ]);
    expect(projection.excludedEvidenceIds).toContain('vacancy-duty');
    expect(JSON.stringify(projection)).not.toContain('Из вакансии');
    expect(
      projection.germanyVariant.unknowns.some(
        (item) =>
          item.code === 'ineligible-evidence' && item.memoryId === 'vacancy-duty',
      ),
    ).toBe(true);
  });

  it('keeps unusually strong quantitative claims visible instead of silently passing them', () => {
    const projection = buildResumeStudioProjection({
      ...completeInput(),
      evidence: [
        ...confirmedEvidence,
        evidence('outcome-scale', 'Увеличила выручку на 400% за один квартал.'),
        evidence('outcome-plain', 'Отвечала за операционное планирование команды.'),
      ],
      experience: [
        {
          id: 'current-role',
          chronologyMemoryId: 'role-current',
          title: 'Technology & Operations Director',
          employer: 'Example GmbH',
          startDate: '2022-01',
          current: true,
          bulletMemoryIds: ['outcome-scale', 'outcome-plain'],
        },
      ],
    });

    const bullets = projection.master.experience[0]?.bullets ?? [];
    expect(bullets[0]).toMatchObject({
      memoryId: 'outcome-scale',
      reviewFlags: ['quantitative-claim-needs-substantiation'],
    });
    expect(bullets[1]?.reviewFlags).toEqual([]);
  });

  it('flags contradictory and unreadable dates in both variants', () => {
    const projection = buildResumeStudioProjection({
      ...completeInput(),
      experience: [
        {
          id: 'current-role',
          chronologyMemoryId: 'role-current',
          title: 'Director',
          employer: 'Example GmbH',
          startDate: 'весна 2022',
          endDate: '2023-06',
          current: true,
          bulletMemoryIds: ['outcome-current'],
        },
      ],
    });

    for (const document of [projection.master, projection.germanyVariant]) {
      const codes = document.unknowns.map((item) => item.code);
      expect(codes).toContain('invalid-chronology-date');
      expect(codes).toContain('chronology-conflict');
    }
    expect(projection.master.experience[0]?.endDate).toBeNull();
  });

  it('returns an entirely unknown document for an empty draft', () => {
    const projection = buildResumeStudioProjection({
      ...EMPTY_RESUME_DRAFT,
      evidence: [],
    });

    expect(projection.master.unknowns.map((item) => item.code)).toEqual([
      'missing-full-name',
      'missing-contact',
      'missing-role-chronology',
      'missing-education',
      'missing-language-level',
    ]);
    expect(projection.master.length.pages).toBe(1);
    expect(projection.evidenceSnapshot).toEqual([]);
    expect(projection.excludedEvidenceIds).toEqual([]);
    expect(projection.germanyVariant.targetRole).toBeNull();
  });
});

describe('Resume Studio draft boundary', () => {
  it('accepts a candidate-entered draft and rejects demographic or malformed fields', () => {
    const parsed = resumeDraftSchema.parse({
      candidate: { fullName: '  Mila Example  ', contact: { email: 'mila@example.test' } },
      experience: [
        {
          id: 'current-role',
          chronologyMemoryId: 'role-current',
          current: true,
          bulletMemoryIds: ['outcome-current'],
        },
      ],
    });
    expect(parsed).toMatchObject({
      candidate: { fullName: 'Mila Example', contact: { links: [] } },
      education: [],
      languages: [],
    });

    for (const invalid of [
      { candidate: { fullName: 'Mila', photo: 'bytes' } },
      { candidate: { birthDate: '1990-01-01' } },
      { candidate: { contact: { maritalStatus: 'married' } } },
      { candidate: {}, religion: 'none' },
      { candidate: { contact: { email: 'not-an-email' } } },
      {
        candidate: {},
        experience: [
          {
            id: 'ok id with spaces',
            chronologyMemoryId: 'role',
            current: false,
            bulletMemoryIds: [],
          },
        ],
      },
      {
        candidate: {},
        languages: [
          { id: 'german', evidenceMemoryId: 'language-de', cefr: 'B3' },
        ],
      },
    ]) {
      expect(resumeDraftSchema.safeParse(invalid).success).toBe(false);
    }
  });
});

describe('Resume Studio evidence freshness', () => {
  it('fails closed when used evidence disappears, changes or loses eligibility', () => {
    const projection = buildResumeStudioProjection(completeInput());
    expect(
      validateResumeEvidenceFreshness(projection.evidenceSnapshot, confirmedEvidence),
    ).toEqual({ valid: true, stale: [] });

    const changedEvidence = confirmedEvidence
      .filter((item) => item.id !== 'education')
      .map((item) => {
        if (item.id === 'outcome-current') {
          return { ...item, status: 'proposed' as const };
        }
        if (item.id === 'role-current') {
          return { ...item, statement: 'Текущая роль была исправлена.' };
        }
        if (item.id === 'language-de') {
          return { ...item, sensitive: true };
        }
        return item;
      });

    const freshness = validateResumeEvidenceFreshness(
      projection.evidenceSnapshot,
      changedEvidence,
    );
    expect(freshness.valid).toBe(false);
    expect(freshness.stale).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memoryId: 'education',
          reasons: ['missing'],
        }),
        expect.objectContaining({
          memoryId: 'outcome-current',
          reasons: expect.arrayContaining(['no-longer-confirmed']),
        }),
        expect.objectContaining({
          memoryId: 'role-current',
          reasons: expect.arrayContaining(['statement-changed']),
        }),
        expect.objectContaining({
          memoryId: 'language-de',
          reasons: expect.arrayContaining(['became-sensitive']),
        }),
      ]),
    );
  });
});

function assertionsIn(
  document: ResumeDocument,
): Array<ResumeAssertion<string | boolean>> {
  const experience = document.experience.flatMap((role) => [
    role.title,
    role.employer,
    role.location,
    role.startDate,
    role.endDate,
    role.current,
    ...role.bullets,
  ]);
  const education = document.education.flatMap((item) => [
    item.institution,
    item.qualification,
    item.startDate,
    item.endDate,
  ]);
  const languages = document.languages.flatMap((item) => [
    item.name,
    item.cefr,
  ]);
  return [...experience, ...education, ...languages].filter(
    (item): item is ResumeAssertion<string | boolean> => item !== null,
  );
}
