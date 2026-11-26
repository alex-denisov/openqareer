import { describe, expect, it } from 'vitest';
import type { RewriteMemory } from './experienceFactRewrite';
import type { ResumeDraft } from './resumeDraft';
import { asksResumeEdit, resumeEditRequest } from './resumeEditRequest';

const fact = (
  id: string,
  statement: string,
  extra: Partial<RewriteMemory> = {},
): RewriteMemory => ({
  id,
  kind: 'fact',
  domain: 'outcome',
  statement,
  status: 'confirmed',
  provenance: { kind: 'candidate' },
  ...extra,
});

const entry = (id: string, employer: string, bulletMemoryIds: string[] = []) =>
  ({
    id,
    employer,
    title: 'VP',
    chronologyMemoryId: `c-${id}`,
    current: false,
    bulletMemoryIds,
  }) as ResumeDraft['experience'][number];

const draftOf = (extra: Partial<ResumeDraft> = {}): ResumeDraft =>
  ({
    candidate: {},
    experience: [entry('e-opti', 'OptiLab AI'), entry('e-ros', 'Россети Цифра', ['placed'])],
    education: [],
    languages: [],
    ...extra,
  }) as ResumeDraft;

const memory = [
  fact('placed', 'Россети Цифра: стоит в резюме'),
  fact('margin', 'Россети Цифра: рентабельность 40 %'),
  fact('opti', 'OptiLab AI: 12 внедрений агентов'),
];

const ASK = 'Поправь в резюме формулировку опыта в Россети Цифра';

describe('B786: просьба поправить резюме даёт правку K6', () => {
  it('узнаёт просьбу о правке резюме и не путает её с вопросом', () => {
    expect(asksResumeEdit(ASK)).toBe(true);
    expect(asksResumeEdit('Rewrite my resume bullet for VK')).toBe(true);
    expect(asksResumeEdit('Что работодатель видит в резюме?')).toBe(false);
    expect(asksResumeEdit('Поправь письмо')).toBe(false);
  });

  it('находит не стоящий в резюме факт названного места работы', () => {
    const request = resumeEditRequest({ memory, resume: { draft: draftOf() } }, ASK);
    expect(request).toEqual({ factId: 'margin', place: 'Россети Цифра' });
  });

  it('узнаёт место работы в другом падеже', () => {
    const request = resumeEditRequest(
      { memory, resume: { draft: draftOf() } },
      'Перепиши в резюме строку о Россети Цифре',
    );
    expect(request?.factId).toBe('margin');
  });

  it('берёт факт из готового предложения консультанта для этого места', () => {
    const proposal = {
      id: 'p1',
      places: [
        { experienceId: 'e-opti', bullets: [{ text: 'x', sourceFactIds: ['opti'] }] },
        { experienceId: 'e-ros', bullets: [{ text: 'y', sourceFactIds: ['placed', 'margin'] }] },
      ],
      leftOutFactIds: [],
      sourceFactIds: ['opti', 'margin'],
    };
    const draft = draftOf({
      factRewriteProposal: { digest: 'd', proposal },
    } as unknown as Partial<ResumeDraft>);
    expect(resumeEditRequest({ memory, resume: { draft } }, ASK)?.factId).toBe('margin');
    expect(resumeEditRequest({ memory, resume: { draft } }, 'Улучши резюме')).toEqual({
      factId: 'opti',
      place: '',
    });
  });

  it('не предлагает отклонённый кандидатом факт и молчит, когда ставить нечего', () => {
    const declined = draftOf({ declinedFactIds: ['margin'] });
    expect(resumeEditRequest({ memory, resume: { draft: declined } }, ASK)).toBeNull();
    expect(resumeEditRequest({ memory, resume: { draft: draftOf() } }, 'Улучши резюме')).toBeNull();
    expect(resumeEditRequest({ memory, resume: null }, ASK)).toBeNull();
  });
});
