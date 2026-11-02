import { describe, expect, it } from 'vitest';
import type { VacancyFitFact } from './vacancyFit';
import { MAX_FIT_EVIDENCE_BYTES } from './vacancyFitProfileEvidence';
import { vacancyFitPromptFacts } from './vacancyFitPromptFacts';

const fact = (id: string, statement: string): VacancyFitFact => ({
  id,
  candidateId: 'cand',
  kind: 'fact',
  status: 'confirmed',
  statement,
  sourceMessageIds: ['m'],
  sensitive: false,
  evidenceSource: 'memory',
});
const requirement = (id: string, text: string) => ({ id, text }) as never;
const bytesOf = (facts: readonly VacancyFitFact[]) =>
  Buffer.byteLength(JSON.stringify(facts.map(({ id, statement }) => ({ id, statement }))));

describe('facts sent to the model are chosen per vacancy (02.11, 138916164 at 25 %)', () => {
  // The owner's profile fills 30 KB; facts were cut by order, so «команда выросла с 4 до 11» and
  // «затраты команд в моём P&L» never reached the model and it answered «неизвестно».
  const filler = Array.from({ length: 300 }, (_, i) =>
    fact(`f${i}`, `Настроил мониторинг облачной платформы номер ${i}. `.repeat(3)),
  );
  const teams = fact('teams', 'Команда расширилась с четырех до одиннадцати человек');
  const budget = fact(
    'budget',
    'Затраты на команды, перешедшие под моё управление, перешли в мой P&L и бюджет',
  );
  const place = {
    ...fact('profile:experience:e9', 'Head of Technical Support, 2020–2023'),
    evidenceSource: 'profile' as const,
  };
  const about = {
    ...fact('profile:about', 'VP of Technology & Operations'),
    evidenceSource: 'profile' as const,
  };
  const all = [about, ...filler, place, teams, budget];

  it('a relevant fact past the old cut-off reaches the model, within the byte budget', () => {
    const sent = vacancyFitPromptFacts(all, [
      requirement('r1', 'Опыт управления несколькими командами'),
      requirement('r2', 'Навыки бюджетирования'),
    ]);
    const ids = sent.map((item) => item.id);
    expect(bytesOf(all)).toBeGreaterThan(MAX_FIT_EVIDENCE_BYTES);
    expect(bytesOf(sent)).toBeLessThanOrEqual(MAX_FIT_EVIDENCE_BYTES);
    expect(ids).toEqual(
      expect.arrayContaining(['teams', 'budget', 'profile:experience:e9', 'profile:about']),
    );
  });

  it('matches an English fact to a Russian requirement', () => {
    const support = fact('support', 'Led technical support and service desk of a public cloud');
    const sent = vacancyFitPromptFacts(
      [...filler, support],
      [requirement('r1', 'Руководитель технической поддержки')],
    );
    expect(sent.map((item) => item.id)).toContain('support');
  });

  it('a small profile goes whole and in its own order', () => {
    const small = [about, teams, budget];
    expect(vacancyFitPromptFacts(small, [requirement('r1', 'Бюджет')])).toEqual(small);
  });
});
