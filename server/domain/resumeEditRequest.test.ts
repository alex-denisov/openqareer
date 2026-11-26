import { describe, expect, it } from 'vitest';
import {
  buildFactRewriteRequest,
  factRewriteDigest,
  type RewriteMemory,
} from './experienceFactRewrite';
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
  fact('placed', 'Improved profitability from 16% to 40%.', { provenance: { kind: 'import' } }),
  fact('margin', 'Россети Цифра: рентабельность 40 %'),
  fact('opti', 'OptiLab AI: 12 внедрений агентов'),
];

const ASK = 'Поправь в резюме формулировку опыта в Россети Цифра';

/** Предложение консультанта, сохранённое под текущим входом. */
function withProposal(draft: ResumeDraft): ResumeDraft {
  const proposal = {
    id: 'p1',
    places: [
      { experienceId: 'e-opti', bullets: [{ text: 'x', sourceFactIds: ['opti'] }] },
      { experienceId: 'e-ros', bullets: [{ text: 'y', sourceFactIds: ['margin'] }] },
    ],
    leftOutFactIds: [],
    sourceFactIds: ['opti', 'margin'],
  };
  const digest = factRewriteDigest(buildFactRewriteRequest(draft, memory));
  return { ...draft, factRewriteProposal: { digest, proposal } };
}

describe('B786: просьба поправить резюме даёт правку K6', () => {
  it('узнаёт просьбу о правке резюме и не путает её с вопросом', () => {
    expect(asksResumeEdit(ASK)).toBe(true);
    expect(asksResumeEdit('Rewrite my resume bullet for VK')).toBe(true);
    expect(asksResumeEdit('Что работодатель видит в резюме?')).toBe(false);
    expect(asksResumeEdit('Поправь письмо')).toBe(false);
  });

  it('берёт пункт из действующего предложения консультанта для названного места', () => {
    const draft = withProposal(draftOf());
    expect(resumeEditRequest({ memory, resume: { draft } }, ASK)).toEqual({
      kind: 'fact',
      factId: 'margin',
      place: 'Россети Цифра',
    });
    expect(resumeEditRequest({ memory, resume: { draft } }, 'Улучши резюме')).toEqual({
      kind: 'fact',
      factId: 'opti',
      place: '',
    });
  });

  it('без действующего предложения переписывает строку места, в том числе в другом падеже', () => {
    const reword = { kind: 'reword', experienceId: 'e-ros', place: 'Россети Цифра' };
    expect(resumeEditRequest({ memory, resume: { draft: draftOf() } }, ASK)).toEqual(reword);
    const stale = { ...withProposal(draftOf()), declinedFactIds: ['opti'] };
    expect(
      resumeEditRequest({ memory, resume: { draft: stale } }, 'Перепиши в резюме строку о Россети Цифре'),
    ).toEqual(reword);
  });

  it('молчит, когда место не названо, строк в нём нет или резюме нет', () => {
    expect(resumeEditRequest({ memory, resume: { draft: draftOf() } }, 'Улучши резюме')).toBeNull();
    expect(
      resumeEditRequest({ memory, resume: { draft: draftOf() } }, 'Поправь в резюме OptiLab AI'),
    ).toBeNull();
    expect(resumeEditRequest({ memory, resume: null }, ASK)).toBeNull();
  });
});
