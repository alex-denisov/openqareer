import { describe, expect, it } from 'vitest';
import {
  createCandidateAnalysis,
  completeCandidateAnalysis,
} from '../evidence/evidenceEngine';
import {
  analyzeOpportunity,
  createOpportunityRecord,
  recordOpportunityDecision,
} from '../opportunity/opportunityEngine';
import { createActionPackage } from '../action/actionPackageEngine';
import { recordOutcome } from '../outcome/outcomeEngine';
import {
  clearWorkspace,
  createWorkspace,
  loadWorkspace,
  saveWorkspace,
  validateWorkspaceInput,
  type StorageLike,
} from './workspaceStorage';

function createMemoryStorage(initial: Record<string, string> = {}): StorageLike {
  const values = new Map(Object.entries(initial));

  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

const validInput = {
  resumeText:
    'Руководил запуском продукта и координировал работу команды. Отвечал за сроки, приоритеты и проверку результата на каждом этапе.',
  resumeSource: 'pdf' as const,
  resumeFileName: 'synthetic-resume.pdf',
  resumePageCount: 2,
  targetDirection: 'Руководитель продукта',
  market: 'ru' as const,
  currentSituation:
    'Завершил предыдущий проект и выбираю следующий осмысленный переход.',
  constraints: 'Не рассматриваю роли без влияния на продуктовые решения.',
  urgency: 'active' as const,
  linkedinUrl: 'https://www.linkedin.com/in/example',
  hhUrl: 'https://hh.ru/resume/example',
};

describe('workspace validation', () => {
  it('allows a candidate to start from a career question without a resume or target title', () => {
    expect(
      validateWorkspaceInput({
        resumeText: '',
        resumeSource: 'text',
        targetDirection: '',
        market: 'ru',
        currentSituation:
          'Я давно не получаю приглашений и не понимаю, какую роль искать.',
        constraints: '',
        urgency: 'exploring',
      }),
    ).toEqual({});
  });

  it('returns accessible field errors for incomplete input', () => {
    expect(
      validateWorkspaceInput({
        resumeText: 'Слишком коротко',
        resumeSource: 'text',
        targetDirection: '',
        market: 'ru',
        currentSituation: '',
        constraints: '',
        urgency: 'exploring',
        linkedinUrl: 'https://example.com/not-linkedin',
        hhUrl: 'not a url',
      }),
    ).toEqual({
      resumeText: 'Добавьте хотя бы 80 знаков, чтобы сохранить рабочий контекст.',
      targetDirection: 'Укажите роль или направление.',
      currentSituation: 'Коротко опишите, где вы находитесь сейчас.',
      linkedinUrl: 'Укажите ссылку на профиль linkedin.com.',
      hhUrl: 'Укажите ссылку на резюме hh.ru.',
    });
  });

  it('accepts a sufficiently complete local input', () => {
    expect(validateWorkspaceInput(validInput)).toEqual({});
  });
});

describe('workspace persistence', () => {
  it('saves and restores a versioned workspace', () => {
    const storage = createMemoryStorage();
    const workspace = createWorkspace(validInput, '2026-07-30T16:00:00.000Z');

    saveWorkspace(storage, workspace);

    expect(loadWorkspace(storage)).toEqual({
      status: 'ready',
      workspace,
    });
  });

  it('accepts only hh source links in a persisted market sample', () => {
    const workspace = {
      ...createWorkspace(validInput, '2026-07-30T16:00:00.000Z'),
      marketSample: {
        source: 'hh' as const,
        query: 'Руководитель продукта',
        found: 1,
        fetchedAt: '2026-08-07T13:00:00.000Z',
        items: [
          {
            id: '123',
            title: 'Руководитель продукта',
            company: 'Пример',
            location: 'Москва',
            sourceUrl: 'javascript:alert(1)',
            publishedAt: null,
            salary: null,
          },
        ],
      },
    };
    const storage = createMemoryStorage({
      'candidate-workspace': JSON.stringify(workspace),
    });

    expect(loadWorkspace(storage)).toEqual({ status: 'invalid' });
  });

  it('rejects corrupt or unknown persisted data without throwing', () => {
    const corrupt = createMemoryStorage({
      'candidate-workspace': '{not json',
    });
    const future = createMemoryStorage({
      'candidate-workspace': JSON.stringify({ version: 99 }),
    });

    expect(loadWorkspace(corrupt)).toEqual({ status: 'invalid' });
    expect(loadWorkspace(future)).toEqual({ status: 'invalid' });
  });

  it('drops legacy analysis that was invented from a conversation-only problem', () => {
    const workspace = createWorkspace(
      {
        ...validInput,
        resumeText: '',
        resumeSource: 'text',
        targetDirection: 'Synthetic Product Operations Lead',
      },
      '2026-08-09T12:00:00.000Z',
    );
    const staleAnalysis = completeCandidateAnalysis(
      workspace.targetDirection,
      createCandidateAnalysis(workspace.currentSituation),
      '2026-08-09T12:05:00.000Z',
    );
    const storage = createMemoryStorage({
      'candidate-workspace': JSON.stringify({
        ...workspace,
        analysis: staleAnalysis,
      }),
    });

    const loaded = loadWorkspace(storage);

    expect(loaded.status).toBe('ready');
    if (loaded.status === 'ready') {
      expect(loaded.workspace.analysis).toBeUndefined();
      expect(loaded.workspace.currentSituation).toBe(
        workspace.currentSituation,
      );
    }
  });

  it('migrates a valid version-one workspace without losing user input', () => {
    const legacyWorkspace = {
      ...createWorkspace(validInput, '2026-07-30T16:00:00.000Z'),
      version: 1,
      outcomes: undefined,
    };
    const storage = createMemoryStorage({
      'candidate-workspace': JSON.stringify(legacyWorkspace),
    });
    const result = loadWorkspace(storage);

    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.workspace.version).toBe(5);
      expect(result.workspace.resumeText).toBe(validInput.resumeText);
      expect(result.workspace.analysis).toBeUndefined();
    }
  });

  it('keeps reviewed evidence only while its resume and target stay current', () => {
    const workspace = createWorkspace(validInput, '2026-07-30T16:00:00.000Z');
    const analysis = completeCandidateAnalysis(
      workspace.targetDirection,
      createCandidateAnalysis(workspace.resumeText),
      '2026-07-30T16:05:00.000Z',
    );
    const reviewedWorkspace = { ...workspace, analysis };

    expect(
      createWorkspace(
        { ...validInput, constraints: 'Обновлённое ограничение' },
        '2026-07-30T16:10:00.000Z',
        reviewedWorkspace,
      ).analysis,
    ).toEqual(analysis);
    expect(
      createWorkspace(
        { ...validInput, targetDirection: 'Program Manager' },
        '2026-07-30T16:10:00.000Z',
        reviewedWorkspace,
      ).analysis,
    ).toBeUndefined();
  });

  it('keeps an opportunity only while the evidence, market and constraints stay current', () => {
    const workspace = createWorkspace(validInput, '2026-07-30T16:00:00.000Z');
    const analysis = completeCandidateAnalysis(
      workspace.targetDirection,
      createCandidateAnalysis(workspace.resumeText),
      '2026-07-30T16:05:00.000Z',
    );
    const record = createOpportunityRecord(
      {
        title: 'Руководитель продукта',
        company: 'Пример',
        text:
          'Задачи\nФормировать продуктовую стратегию и управлять командой.\nТребования\nОпыт запуска цифровых продуктов и проведения исследований.\nУсловия\nУдалённая работа, полная занятость.',
        sourceLabel: 'Ручной ввод',
      },
      '2026-07-30T16:06:00.000Z',
    );
    const withAnalysis = {
      ...workspace,
      analysis,
      opportunity: {
        ...record,
        analysis: analyzeOpportunity(record, analysis.evidenceItems, 'clear'),
      },
    };

    expect(
      createWorkspace(
        { ...validInput, currentSituation: `${validInput.currentSituation} Да.` },
        '2026-07-30T16:10:00.000Z',
        withAnalysis,
      ).opportunity,
    ).toEqual(withAnalysis.opportunity);
    expect(
      createWorkspace(
        { ...validInput, constraints: 'Только офисная работа.' },
        '2026-07-30T16:10:00.000Z',
        withAnalysis,
      ).opportunity,
    ).toBeUndefined();
  });

  it('saves an action package and migrates a version-three workspace without one', () => {
    const workspace = createWorkspace(validInput, '2026-07-30T16:00:00.000Z');
    const extracted = createCandidateAnalysis(workspace.resumeText);
    const evidenceItems = extracted.evidenceItems.map((item) => ({
      ...item,
      status: 'confirmed' as const,
    }));
    const analysis = completeCandidateAnalysis(
      workspace.targetDirection,
      { ...extracted, evidenceItems },
      '2026-07-30T16:05:00.000Z',
    );
    const opportunity = createOpportunityRecord(
      {
        title: 'Руководитель продукта',
        company: 'Пример',
        text:
          'Задачи\nЗапускать цифровые продукты и управлять командой.\nТребования\nПодтверждённый опыт запуска продукта и управления командой.\nУсловия\nУдалённая работа, полная занятость.',
        sourceLabel: 'Ручной ввод',
      },
      '2026-07-30T16:06:00.000Z',
    );
    const analyzed = {
      ...opportunity,
      analysis: analyzeOpportunity(opportunity, evidenceItems, 'clear'),
    };
    const decided = recordOpportunityDecision(
      analyzed,
      'apply',
      'Вакансия соответствует выбранному направлению.',
      '2026-07-30T16:07:00.000Z',
    );
    const actionPackage = createActionPackage(
      decided,
      evidenceItems,
      workspace.targetDirection,
      '2026-07-30T16:08:00.000Z',
    );
    const complete = {
      ...workspace,
      analysis,
      opportunity: decided,
      actionPackage,
    };
    const storage = createMemoryStorage();

    saveWorkspace(storage, complete);
    expect(loadWorkspace(storage)).toEqual({
      status: 'ready',
      workspace: complete,
    });

    const unknownEvidenceStorage = createMemoryStorage({
      'candidate-workspace': JSON.stringify({
        ...complete,
        actionPackage: {
          ...actionPackage,
          selectedEvidenceIds: ['missing-evidence'],
        },
      }),
    });
    const mismatchedOpportunityStorage = createMemoryStorage({
      'candidate-workspace': JSON.stringify({
        ...complete,
        actionPackage: {
          ...actionPackage,
          opportunityId: 'another-opportunity',
        },
      }),
    });

    expect(loadWorkspace(unknownEvidenceStorage)).toEqual({
      status: 'invalid',
    });
    expect(loadWorkspace(mismatchedOpportunityStorage)).toEqual({
      status: 'invalid',
    });

    const outcome = recordOutcome(
      decided.id,
      {
        type: 'applied',
        occurredAt: '2026-07-30T16:09:00.000Z',
        note: 'Отклик отправлен вручную.',
        followUpAt: '2026-08-04T16:09:00.000Z',
      },
      '2026-07-30T16:10:00.000Z',
    );
    const withOutcome = { ...complete, outcomes: [outcome] };
    const outcomeStorage = createMemoryStorage();
    saveWorkspace(outcomeStorage, withOutcome);

    expect(loadWorkspace(outcomeStorage)).toEqual({
      status: 'ready',
      workspace: withOutcome,
    });
    const foreignOutcomeStorage = createMemoryStorage({
      'candidate-workspace': JSON.stringify({
        ...complete,
        outcomes: [{ ...outcome, opportunityId: 'another-opportunity' }],
      }),
    });
    expect(loadWorkspace(foreignOutcomeStorage)).toEqual({
      status: 'invalid',
    });
    const malformedOutcomeStorage = createMemoryStorage({
      'candidate-workspace': JSON.stringify({
        ...complete,
        outcomes: [{ ...outcome, recordedAt: 'not-a-date' }],
      }),
    });
    expect(loadWorkspace(malformedOutcomeStorage)).toEqual({
      status: 'invalid',
    });

    const versionThree = {
      ...complete,
      version: 3,
      actionPackage: undefined,
      outcomes: undefined,
    };
    const legacyStorage = createMemoryStorage({
      'candidate-workspace': JSON.stringify(versionThree),
    });
    const migrated = loadWorkspace(legacyStorage);

    expect(migrated.status).toBe('ready');
    if (migrated.status === 'ready') {
      expect(migrated.workspace.version).toBe(5);
      expect(migrated.workspace.opportunity).toEqual(decided);
      expect(migrated.workspace.actionPackage).toBeUndefined();
      expect(migrated.workspace.outcomes).toEqual([]);
    }

    const versionFourStorage = createMemoryStorage({
      'candidate-workspace': JSON.stringify({
        ...complete,
        version: 4,
        outcomes: undefined,
      }),
    });
    const migratedVersionFour = loadWorkspace(versionFourStorage);

    expect(migratedVersionFour.status).toBe('ready');
    if (migratedVersionFour.status === 'ready') {
      expect(migratedVersionFour.workspace.version).toBe(5);
      expect(migratedVersionFour.workspace.actionPackage).toEqual(
        actionPackage,
      );
      expect(migratedVersionFour.workspace.outcomes).toEqual([]);
    }
  });

  it('restores a valid reviewed analysis and rejects malformed derived data', () => {
    const workspace = createWorkspace(validInput, '2026-07-30T16:00:00.000Z');
    const extracted = createCandidateAnalysis(workspace.resumeText);
    const evidenceItems = extracted.evidenceItems.map((item) => ({
      ...item,
      status: 'confirmed' as const,
    }));
    const analysis = completeCandidateAnalysis(
      workspace.targetDirection,
      { ...extracted, evidenceItems },
      '2026-07-30T16:05:00.000Z',
    );
    const reviewed = { ...workspace, analysis };
    const validStorage = createMemoryStorage({
      'candidate-workspace': JSON.stringify(reviewed),
    });

    expect(loadWorkspace(validStorage)).toEqual({
      status: 'ready',
      workspace: reviewed,
    });

    const invalidVariants: unknown[] = [
      { ...reviewed, analysis: null },
      {
        ...reviewed,
        analysis: { ...analysis, evidenceMethodVersion: 'unknown' },
      },
      { ...reviewed, analysis: { ...analysis, roleMethodVersion: 'unknown' } },
      { ...reviewed, analysis: { ...analysis, evidenceItems: 'not-an-array' } },
      {
        ...reviewed,
        analysis: {
          ...analysis,
          evidenceItems: [{ ...analysis.evidenceItems[0], kind: 'opinion' }],
        },
      },
      {
        ...reviewed,
        analysis: {
          ...analysis,
          evidenceItems: [
            { ...analysis.evidenceItems[0], sourceExcerpt: 42 },
          ],
        },
      },
      {
        ...reviewed,
        analysis: {
          ...analysis,
          evidenceItems: [{ ...analysis.evidenceItems[0], status: 'approved' }],
        },
      },
      { ...reviewed, analysis: { ...analysis, questions: [42] } },
      {
        ...reviewed,
        analysis: { ...analysis, roleHypotheses: 'not-an-array' },
      },
      {
        ...reviewed,
        analysis: {
          ...analysis,
          roleHypotheses: [
            { ...analysis.roleHypotheses[0], fitState: 'certain' },
          ],
        },
      },
      {
        ...reviewed,
        analysis: {
          ...analysis,
          roleHypotheses: [
            { ...analysis.roleHypotheses[0], evidenceIds: [42] },
          ],
        },
      },
      {
        ...reviewed,
        analysis: {
          ...analysis,
          roleHypotheses: [{ ...analysis.roleHypotheses[0], gaps: [42] }],
        },
      },
      { ...reviewed, analysis: { ...analysis, reviewedAt: 42 } },
    ];

    for (const invalid of invalidVariants) {
      const storage = createMemoryStorage({
        'candidate-workspace': JSON.stringify(invalid),
      });
      expect(loadWorkspace(storage)).toEqual({ status: 'invalid' });
    }
  });

  it('restores a decided opportunity and rejects malformed opportunity state', () => {
    const workspace = createWorkspace(validInput, '2026-07-30T16:00:00.000Z');
    const extracted = createCandidateAnalysis(workspace.resumeText);
    const candidateAnalysis = {
      ...extracted,
      evidenceItems: extracted.evidenceItems.map((item) => ({
        ...item,
        status: 'confirmed' as const,
      })),
    };
    const record = createOpportunityRecord(
      {
        title: 'Руководитель продукта',
        company: 'Пример',
        text:
          'Задачи\nФормировать продуктовую стратегию и управлять командой.\nТребования\nОпыт запуска цифровых продуктов и проведения исследований.\nУсловия\nУдалённая работа, полная занятость.',
        sourceLabel: 'Ручной ввод',
        sourceUrl: 'https://example.com/job',
      },
      '2026-07-30T16:06:00.000Z',
    );
    const analyzed = {
      ...record,
      analysis: analyzeOpportunity(
        record,
        candidateAnalysis.evidenceItems,
        'clear',
      ),
    };
    const opportunity = recordOpportunityDecision(
      analyzed,
      'network',
      'Хочу сначала уточнить задачи и уровень роли.',
      '2026-07-30T16:07:00.000Z',
    );
    const ready = {
      ...workspace,
      analysis: completeCandidateAnalysis(
        workspace.targetDirection,
        candidateAnalysis,
        '2026-07-30T16:05:00.000Z',
      ),
      opportunity,
    };

    expect(
      loadWorkspace(
        createMemoryStorage({
          'candidate-workspace': JSON.stringify(ready),
        }),
      ),
    ).toEqual({ status: 'ready', workspace: ready });

    const invalidVariants: unknown[] = [
      { ...ready, opportunity: null },
      { ...ready, opportunity: { ...opportunity, id: 42 } },
      {
        ...ready,
        opportunity: {
          ...opportunity,
          sourceUrl: 42,
        },
      },
      {
        ...ready,
        opportunity: {
          ...opportunity,
          parsed: { ...opportunity.parsed, methodVersion: 'unknown' },
        },
      },
      {
        ...ready,
        opportunity: {
          ...opportunity,
          parsed: {
            ...opportunity.parsed,
            items: [{ ...opportunity.parsed.items[0], kind: 'benefit' }],
          },
        },
      },
      {
        ...ready,
        opportunity: {
          ...opportunity,
          parsed: { ...opportunity.parsed, unknowns: [42] },
        },
      },
      {
        ...ready,
        opportunity: {
          ...opportunity,
          analysis: {
            ...opportunity.analysis,
            hardConstraintAssessment: 'maybe',
          },
        },
      },
      {
        ...ready,
        opportunity: {
          ...opportunity,
          analysis: { ...opportunity.analysis, recommendation: 'score' },
        },
      },
      {
        ...ready,
        opportunity: {
          ...opportunity,
          analysis: {
            ...opportunity.analysis,
            matches: [
              {
                opportunityItemId: 42,
                evidenceIds: [],
                sharedSignals: [],
              },
            ],
          },
        },
      },
      {
        ...ready,
        opportunity: {
          ...opportunity,
          decision: { ...opportunity.decision, choice: 'maybe' },
        },
      },
      {
        ...ready,
        opportunity: {
          ...opportunity,
          decision: { ...opportunity.decision, reason: 42 },
        },
      },
    ];

    for (const invalid of invalidVariants) {
      expect(
        loadWorkspace(
          createMemoryStorage({
            'candidate-workspace': JSON.stringify(invalid),
          }),
        ),
      ).toEqual({ status: 'invalid' });
    }
  });

  it('clears the local workspace', () => {
    const storage = createMemoryStorage();
    const workspace = createWorkspace(validInput, '2026-07-30T16:00:00.000Z');
    saveWorkspace(storage, workspace);

    clearWorkspace(storage);

    expect(loadWorkspace(storage)).toEqual({ status: 'empty' });
  });
});
