import { describe, expect, it } from 'vitest';
import { applyFactRewrite, revertFactRewrite, type RewriteMemory } from './experienceFactRewrite';
import { checkFactRewriteVariant } from './factRewriteVariant';
import { rewordProposal, rewordRequest, rewordTarget } from './factReword';
import type { ResumeDraft } from './resumeDraft';

const fact = (id: string, statement: string, extra: Partial<RewriteMemory> = {}) => ({
  id,
  kind: 'fact',
  domain: 'outcome',
  statement,
  status: 'confirmed',
  provenance: { kind: 'candidate' },
  ...extra,
});

const memory = [
  fact('line-1', 'Руководил двумя направлениями из 250 специалистов.', {
    provenance: { kind: 'import' },
  }),
  fact('line-2', 'Довёл рентабельность с 16% до 40%.', { provenance: { kind: 'import' } }),
  fact('margin', 'Россети Цифра: рентабельность 40 %'),
  fact('revenue', 'В Россети Цифра выручка выросла с 230 до 920 миллионов рублей.'),
  fact('guess', 'Россети Цифра: рентабельность 80 %', { kind: 'hypothesis', status: 'proposed' }),
  fact('secret', 'Россети Цифра: зарплата', { sensitive: true } as Partial<RewriteMemory>),
  fact('other', 'VK: команда 40 человек'),
];

const draft = {
  candidate: {},
  experience: [
    {
      id: 'e-ros',
      employer: 'Россети Цифра',
      title: 'VP',
      chronologyMemoryId: 'c-ros',
      current: false,
      bulletMemoryIds: ['line-1', 'line-2'],
    },
  ],
  education: [],
  languages: [],
} as unknown as ResumeDraft;

describe('B786: новая формулировка строки места (k06)', () => {
  it('берёт первую строку места и только подтверждённые факты беседы о нём', () => {
    const target = rewordTarget(draft, memory, 'e-ros');
    expect(target?.memoryId).toBe('line-1');
    expect(target?.current).toBe('Руководил двумя направлениями из 250 специалистов.');
    expect(target?.facts.map((item) => item.id)).toEqual(['line-1', 'margin', 'revenue']);
    expect(rewordTarget(draft, memory, 'missing')).toBeNull();
  });

  it('не принимает чисел, которых нет в строке и фактах (80 % вместо 40 %)', () => {
    const request = rewordRequest(rewordTarget(draft, memory, 'e-ros')!);
    expect(request.avoid).toEqual([request.current]);
    const good = 'Руководил двумя направлениями из 250 специалистов, выручка выросла с 230 до 920 млн рублей.';
    expect(checkFactRewriteVariant(request, { text: good })).toBe(good);
    const invented = 'Руководил двумя направлениями из 250 специалистов, рентабельность выросла до 80%.';
    expect(checkFactRewriteVariant(request, { text: invented })).toBeNull();
  });

  it('«Применить» ставит новую строку на место прежней, «Отменить» возвращает прежнюю', () => {
    const target = rewordTarget(draft, memory, 'e-ros')!;
    const proposal = rewordProposal(target, 'Новая первая строка с 250 специалистами.', 'r1');
    const pending = { digest: 'd', proposal };
    const withPending = { ...draft, factRewordProposal: pending, factRewriteProposal: pending };
    const applied = applyFactRewrite(withPending, proposal, () => 'new-1', '2026-11-26T19:00:00Z');
    expect(applied.draft.experience[0]?.bulletMemoryIds).toEqual(['new-1', 'line-2']);
    expect(applied.record.bullets[0]?.replacedMemoryId).toBe('line-1');
    expect(applied.draft.factRewordProposal).toBeUndefined();
    expect(applied.draft.factRewriteProposal).toBe(pending);
    const reverted = revertFactRewrite(applied.draft, 'r1');
    expect(reverted?.draft.experience[0]?.bulletMemoryIds).toEqual(['line-1', 'line-2']);
    expect(reverted?.bulletMemoryIds).toEqual(['new-1']);
  });
});
