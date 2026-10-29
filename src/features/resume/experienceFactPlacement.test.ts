import { describe, expect, it } from 'vitest';
import type { CandidateMemory } from '../coach/coachApi';
import {
  acceptFactPlacements,
  declineFacts,
  placeExperienceFacts,
} from './experienceFactPlacement';
import type { ResumeDraft, ResumeExperienceInput } from './resumeTypes';

function place(
  id: string,
  employer: string,
  startDate: string,
  endDate?: string,
  bulletMemoryIds: string[] = [],
): ResumeExperienceInput {
  return {
    id,
    chronologyMemoryId: `${id}-chronology`,
    title: 'Director',
    employer,
    startDate,
    ...(endDate ? { endDate } : { current: true }),
    bulletMemoryIds,
  } as ResumeExperienceInput;
}

function fact(
  id: string,
  statement: string,
  overrides: Partial<CandidateMemory> = {},
): CandidateMemory {
  return {
    id,
    kind: 'fact',
    domain: 'responsibility',
    statement,
    confidence: 'candidate-reported',
    sourceMessageIds: [`msg-${id}`],
    sensitive: false,
    status: 'confirmed',
    createdAt: '2026-10-25T10:00:00.000Z',
    provenance: { kind: 'candidate', at: '2026-10-25T10:00:00.000Z' },
    ...overrides,
  } as CandidateMemory;
}

const draft = {
  candidate: {},
  experience: [
    place('optilab', 'OptiLab AI', 'Nov 2025'),
    place('rosseti', 'Россети Цифра', 'Apr 2023', 'Oct 2025', ['imp-exp-2-b1']),
    place('vk', 'Enterprise Public Cloud Platform (IaaS / PaaS)', 'Mar 2020', 'Apr 2023'),
    place('fishance', 'Fishance Berhad', 'Jul 2016', 'Oct 2019'),
  ],
  education: [],
  languages: [],
} as unknown as ResumeDraft;

describe('placeExperienceFacts (C10)', () => {
  it('puts a fact into the workplace it names', () => {
    const result = placeExperienceFacts(draft, [
      fact('f1', 'Когда я пришёл в Россети Цифра, выручка направления была 230 млн рублей в год.'),
      fact('f2', 'Fishance: годовая выручка выросла до $50M+, компания продана.'),
    ]);
    expect(result.proposals).toEqual([
      { experienceId: 'rosseti', fact: expect.objectContaining({ id: 'f1' }) },
      { experienceId: 'fishance', fact: expect.objectContaining({ id: 'f2' }) },
    ]);
    expect(result.pending).toEqual([]);
  });

  it('matches a declined form of the employer name («в Россетях Цифры»)', () => {
    const result = placeExperienceFacts(draft, [
      fact('f1', 'В Россетях Цифры я собрал сервисы в пакеты.'),
    ]);
    expect(result.proposals.map((proposal) => proposal.experienceId)).toEqual(['rosseti']);
  });

  it('does not match on a generic word of the employer name', () => {
    const result = placeExperienceFacts(draft, [
      fact('f1', 'Я переводил сервисы в public cloud и строил platform team.'),
    ]);
    expect(result.proposals).toEqual([]);
    expect(result.pending.map((item) => item.id)).toEqual(['f1']);
  });

  it('places a fact by a year that falls into exactly one workplace', () => {
    const result = placeExperienceFacts(draft, [
      fact('f1', 'В 2017 году мы вышли на рынок Малайзии.'),
      fact('f2', 'В 2023 году я сменил компанию.'),
    ]);
    expect(result.proposals).toEqual([
      { experienceId: 'fishance', fact: expect.objectContaining({ id: 'f1' }) },
    ]);
    // 2023 is both the end of one place and the start of another: the candidate decides.
    expect(result.pending.map((item) => item.id)).toEqual(['f2']);
  });

  it('does not hand an unnamed fact the workplace another fact of its message named', () => {
    // The owner's answers were long pastes about several companies at once
    // (29.10): a sibling fact about another company landed under Fishance.
    const shared = { sourceMessageIds: ['answers-part-2'] };
    const result = placeExperienceFacts(draft, [
      fact('f1', 'Fishance: годовая выручка выросла до $50M+.', shared),
      fact('f2', 'ITL4 внедрял вместе со всеми процессами.', shared),
      fact('f3', 'Затраты на подрядчиков входили в расчёт P&L.', shared),
    ]);
    expect(result.proposals.map((proposal) => proposal.fact.id)).toEqual(['f1']);
    expect(result.pending.map((item) => item.id)).toEqual(['f2', 'f3']);
  });

  it('learns a company name from a fact the candidate already put into a workplace', () => {
    // LinkedIn calls the place «Enterprise Public Cloud Platform»; the candidate says «ВКТех».
    const placed = fact('f-placed', 'В первой линии ВКТех было три человека, когда я пришёл.');
    const withPlaced = acceptFactPlacements(draft, [{ experienceId: 'vk', factId: 'f-placed' }]);
    const result = placeExperienceFacts(withPlaced, [
      placed,
      fact('f1', 'В ВКТехе команда расширилась с четырёх до одиннадцати.'),
      fact('f2', 'Тикетов стало на 40% меньше.'),
    ]);
    expect(result.proposals).toEqual([
      { experienceId: 'vk', fact: expect.objectContaining({ id: 'f1' }) },
    ]);
    expect(result.pending.map((item) => item.id)).toEqual(['f2']);
  });

  it('does not learn a name two workplaces share', () => {
    const withBoth = acceptFactPlacements(draft, [
      { experienceId: 'vk', factId: 'f-a' },
      { experienceId: 'fishance', factId: 'f-b' },
    ]);
    const result = placeExperienceFacts(withBoth, [
      fact('f-a', 'Проект с Газпромом в облаке.'),
      fact('f-b', 'Ещё один проект с Газпромом.'),
      fact('f1', 'Газпром продлил контракт.'),
    ]);
    expect(result.pending.map((item) => item.id)).toEqual(['f1']);
  });

  it('only offers confirmed conversation facts that are not in the resume yet', () => {
    const result = placeExperienceFacts(draft, [
      fact('imp-exp-2-b1', 'Россети Цифра: уже пункт места работы.'),
      fact('f-proposed', 'Россети Цифра: ещё не подтверждено.', { status: 'proposed' }),
      fact('f-import', 'Россети Цифра: из импорта.', {
        provenance: { kind: 'import', at: '2026-10-23T10:00:00.000Z' } as never,
      }),
      fact('f-gap', 'Цифра 80% по time-to-market была выдумана.', { domain: 'gap' }),
      fact('f-pref', 'Хочу в Россети Цифра обратно.', { kind: 'preference' }),
      fact('f-ok', 'Россети Цифра: SLA 99,5–100 % по контракту.', { domain: 'outcome' }),
    ]);
    expect(result.proposals.map((proposal) => proposal.fact.id)).toEqual(['f-ok']);
    expect(result.pending).toEqual([]);
  });

  it('never offers a fact the candidate declined', () => {
    const declined = { ...draft, declinedFactIds: ['f1'] } as ResumeDraft;
    const result = placeExperienceFacts(declined, [fact('f1', 'Россети Цифра: P&L.')]);
    expect(result.proposals).toEqual([]);
    expect(result.pending).toEqual([]);
  });
});

describe('acceptFactPlacements / declineFacts (C10)', () => {
  it('writes accepted facts into their workplace after the bullets it already has', () => {
    const next = acceptFactPlacements(draft, [
      { experienceId: 'rosseti', factId: 'f1' },
      { experienceId: 'rosseti', factId: 'f2' },
      { experienceId: 'fishance', factId: 'f3' },
      { experienceId: 'rosseti', factId: 'imp-exp-2-b1' },
    ]);
    expect(next.experience.find((entry) => entry.id === 'rosseti')?.bulletMemoryIds).toEqual([
      'imp-exp-2-b1',
      'f1',
      'f2',
    ]);
    expect(next.experience.find((entry) => entry.id === 'fishance')?.bulletMemoryIds).toEqual([
      'f3',
    ]);
    expect(draft.experience.find((entry) => entry.id === 'rosseti')?.bulletMemoryIds).toEqual([
      'imp-exp-2-b1',
    ]);
  });

  it('moves a fact that sat in another workplace instead of doubling it', () => {
    const once = acceptFactPlacements(draft, [{ experienceId: 'rosseti', factId: 'f1' }]);
    const moved = acceptFactPlacements(once, [{ experienceId: 'vk', factId: 'f1' }]);
    expect(moved.experience.find((entry) => entry.id === 'rosseti')?.bulletMemoryIds).toEqual([
      'imp-exp-2-b1',
    ]);
    expect(moved.experience.find((entry) => entry.id === 'vk')?.bulletMemoryIds).toEqual(['f1']);
  });

  it('records a decline once and keeps the fact itself untouched', () => {
    const once = declineFacts(draft, ['f1', 'f2']);
    const twice = declineFacts(once, ['f2', 'f3']);
    expect(twice.declinedFactIds).toEqual(['f1', 'f2', 'f3']);
    expect(draft.declinedFactIds).toBeUndefined();
  });
});
