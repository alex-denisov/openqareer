import { describe, expect, it } from 'vitest';
import {
  buildRoleHypotheses,
  extractEvidenceCandidates,
  updateEvidenceItem,
} from './evidenceEngine';

const RESUME = `
Руководитель продукта
Запустил B2B-платформу для 12 корпоративных клиентов и увеличил выручку направления на 24%.
Управлял кросс-функциональной командой из 9 человек: продукт, дизайн, аналитика и разработка.
Проводил исследования пользователей, формировал roadmap и отвечал за продуктовые метрики.
Сократил цикл запуска экспериментов с шести до двух недель.
`;

describe('evidence engine', () => {
  it('keeps every extracted claim tied to an exact source excerpt', () => {
    const result = extractEvidenceCandidates(RESUME);

    expect(result.items.length).toBeGreaterThanOrEqual(3);
    for (const item of result.items) {
      expect(RESUME).toContain(item.sourceExcerpt);
      expect(item.statement).toBe(item.sourceExcerpt);
      expect(item.status).toBe('pending');
    }
  });

  it('asks for missing evidence instead of inventing it from sparse input', () => {
    const result = extractEvidenceCandidates('Product manager');

    expect(result.items).toEqual([]);
    expect(result.questions.length).toBeGreaterThan(0);
  });

  it('deduplicates identical repeated bullet points or statements in candidate facts (B178)', () => {
    const duplicateResume = `
Руководитель продукта
- Запустил B2B-платформу для 12 корпоративных клиентов и увеличил выручку направления на 24%.
- Запустил B2B-платформу для 12 корпоративных клиентов и увеличил выручку направления на 24%.
- Управлял кросс-функциональной командой из 9 человек: продукт, дизайн, аналитика и разработка.
    `;
    const result = extractEvidenceCandidates(duplicateResume);
    expect(result.items.length).toBe(2);
    expect(result.items[0].statement).toContain('Запустил B2B-платформу');
    expect(result.items[1].statement).toContain('Управлял кросс-функциональной командой');
  });

  it('joins visual PDF line wraps but does not turn section headings into claims', () => {
    const wrapped = [
      'Опыт',
      'Отвечал за сроки,',
      'качество решений и проверку результатов на каждом этапе работы.',
      'Навыки',
      'Продуктовая стратегия, исследования и аналитика.',
    ].join('\n');
    const result = extractEvidenceCandidates(wrapped);

    expect(result.items.map((item) => item.sourceExcerpt)).toEqual([
      'Отвечал за сроки,\nкачество решений и проверку результатов на каждом этапе работы.',
      'Продуктовая стратегия, исследования и аналитика.',
    ]);
    expect(result.items.some((item) => item.sourceExcerpt.includes('Опыт'))).toBe(
      false,
    );
  });

  it('preserves provenance when the user edits or rejects a candidate', () => {
    const [item] = extractEvidenceCandidates(RESUME).items;
    const edited = updateEvidenceItem(item, {
      statement: 'Запустил B2B-платформу для 12 корпоративных клиентов.',
      status: 'confirmed',
    });
    const rejected = updateEvidenceItem(edited, { status: 'rejected' });

    expect(edited.sourceExcerpt).toBe(item.sourceExcerpt);
    expect(edited.userEdited).toBe(true);
    expect(rejected.status).toBe('rejected');
  });

  it('cannot keep an empty edited statement confirmed', () => {
    const [item] = extractEvidenceCandidates(RESUME).items;
    const confirmed = updateEvidenceItem(item, { status: 'confirmed' });
    const emptied = updateEvidenceItem(confirmed, { statement: '   ' });

    expect(emptied.statement).toBe('');
    expect(emptied.status).toBe('pending');
  });

  it('does not use rejected evidence in role hypotheses', () => {
    const extracted = extractEvidenceCandidates(RESUME);
    const reviewed = extracted.items.map((item, index) =>
      updateEvidenceItem(item, {
        status: index === 0 ? 'rejected' : 'confirmed',
      }),
    );
    const hypotheses = buildRoleHypotheses(
      'Руководитель продукта',
      reviewed,
    );

    // Гипотеза одна — названная кандидатом (B178 срез 2, словарь убран).
    expect(hypotheses.length).toBe(1);
    for (const hypothesis of hypotheses) {
      expect(hypothesis.evidenceIds).not.toContain(reviewed[0].id);
    }
  });

  it('is deterministic for the same reviewed input and method version', () => {
    const first = extractEvidenceCandidates(RESUME);
    const second = extractEvidenceCandidates(RESUME);
    const reviewed = first.items.map((item) =>
      updateEvidenceItem(item, { status: 'confirmed' }),
    );

    expect(first).toEqual(second);
    expect(buildRoleHypotheses('Руководитель продукта', reviewed)).toEqual(
      buildRoleHypotheses('Руководитель продукта', reviewed),
    );
  });
});

/**
 * B178 срез 2 (живой прогон на проде `f8e4b3a`): движок называл роли из
 * зашитой таблицы «ключевое слово → две должности». CV аналитика без единого
 * управленческого эпизода получал `Analytics Lead` и «Руководитель
 * бизнес-аналитики» — обе с одинаковым обоснованием слово в слово, обе из
 * словаря, а не из источника. Роли называет стратег; локальный движок имеет
 * право повторить только то направление, которое кандидат назвал сам.
 */
describe('роль не выдумывается локальным словарём', () => {
  const ANALYST_CV = [
    'Алексей Смирнов, продуктовый аналитик.',
    'Построил сквозную аналитику клиентского пути и когорт, SQL и Python.',
    'Запустил A/B-тесты для трёх продуктовых направлений, метрики в Mixpanel.',
  ].join('\n');

  function confirmedAnalystEvidence() {
    return extractEvidenceCandidates(ANALYST_CV).items.map((item) =>
      updateEvidenceItem(item, { status: 'confirmed' }),
    );
  }

  it('не подставляет должность, которой нет в источнике', () => {
    const hypotheses = buildRoleHypotheses(
      'Продуктовый аналитик',
      confirmedAnalystEvidence(),
    );

    expect(hypotheses.map((role) => role.title)).toEqual([
      'Продуктовый аналитик',
    ]);
  });

  it('без названного направления не называет роль вообще', () => {
    expect(buildRoleHypotheses('', confirmedAnalystEvidence())).toEqual([]);
  });
});
