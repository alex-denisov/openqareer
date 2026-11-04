import { describe, expect, it } from 'vitest';
import { requirementLabels, topRoleKeywords } from './atsRoleKeywords';
import type { VacancyRequirementsResult } from './vacancyRequirements';

describe('topRoleKeywords', () => {
  it('counts each keyword once per vacancy and merges RU and EN synonyms', () => {
    const result = topRoleKeywords([
      ['Управление командой', 'Kafka'],
      ['Team management', 'Kafka', 'Kafka'],
      ['Kafka', 'Terraform'],
    ]);
    expect(result.vacanciesCounted).toBe(3);
    expect(result.keywords[0]).toBe('Kafka');
    expect(result.keywords).toHaveLength(2);
    expect(result.keywords.filter((item) => /команд|team/iu.test(item))).toHaveLength(1);
  });

  it('drops keywords seen in fewer than two vacancies', () => {
    const result = topRoleKeywords([['Kafka', 'Rare'], ['Kafka'], ['Go']]);
    expect(result.keywords).toEqual(['Kafka']);
  });

  it('keeps the top fifteen by frequency, ties alphabetical', () => {
    const rows = Array.from({ length: 3 }, () =>
      Array.from({ length: 20 }, (_, index) => `Skill${String(index).padStart(2, '0')}`),
    );
    rows.push(['Skill19']);
    rows.push(['Skill19']);
    const result = topRoleKeywords(rows);
    expect(result.keywords).toHaveLength(15);
    expect(result.keywords[0]).toBe('Skill19');
    expect(result.keywords[1]).toBe('Skill00');
  });

  it('drops soft skills in every wording, RU and EN', () => {
    const result = topRoleKeywords([
      ['Communication skills', 'Executive communication', 'Kafka', 'стратегическое мышление'],
      ['Коммуникативные навыки', 'Clear communication', 'Kafka', 'Cross-functional collaboration'],
      ['Коммуникабельность', 'Problem solving', 'Стрессоустойчивость', 'Strategic thinking'],
      ['Problem-solving', 'стрессоустойчивость', 'Cross-functional collaboration'],
    ]);
    expect(result.keywords).toEqual(['Kafka']);
  });

  it('keeps leadership and negotiation: an employer screens resumes for them', () => {
    const result = topRoleKeywords([
      ['Leadership', 'Negotiation'],
      ['Leadership', 'Negotiation'],
    ]);
    expect(result.keywords).toHaveLength(2);
  });

  it('does not count vacancies without any requirement', () => {
    expect(topRoleKeywords([[], ['Kafka'], ['Kafka']]).vacanciesCounted).toBe(2);
  });
});

describe('requirementLabels', () => {
  const base = {
    vacancyId: 'cluster-1',
    descriptionHash: 'h',
    extractorVersion: 'v',
    status: 'extracted',
    method: 'model',
  } as const;
  const requirement = (id: string, text: string, label?: string) => ({
    id,
    text,
    sourceQuote: text,
    origin: 'text',
    importance: 'required',
    kind: 'other',
    hard: false,
    stopFactor: false,
    ...(label ? { label, skill: true } : {}),
  });

  it('uses short skill labels and skips long sentences', () => {
    const result = {
      ...base,
      requirements: [
        requirement('1', 'Опыт работы с Kafka', 'Kafka'),
        requirement(
          '2',
          'Умение выстраивать процессы разработки в команде из пятидесяти человек и более',
        ),
      ],
    } as unknown as VacancyRequirementsResult;
    expect(requirementLabels(result)).toEqual(['Kafka']);
  });

  it('drops job titles: a role and a saved vacancy both read keywords from here', () => {
    const result = {
      ...base,
      requirements: [
        requirement('1', 'CTO', 'CTO'),
        requirement('2', 'VP-Of-Engineering', 'VP-Of-Engineering'),
        requirement('3', 'Опыт работы с Kafka', 'Kafka'),
      ],
    } as unknown as VacancyRequirementsResult;
    expect(requirementLabels(result)).toEqual(['Kafka']);
  });
});
