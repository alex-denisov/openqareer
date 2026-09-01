import { describe, expect, it } from 'vitest';
import type { CandidateMemory } from '../coach/coachApi';
import {
  ASSESSMENT_METHOD_VERSION,
  assessProfile,
  type ProfileAssessment,
} from './profileAssessment';

function fact(
  id: string,
  domain: CandidateMemory['domain'],
  statement: string,
  status: CandidateMemory['status'] = 'confirmed',
): CandidateMemory {
  return {
    id,
    kind: 'fact',
    domain,
    statement,
    confidence: 'candidate-confirmed',
    sourceMessageIds: ['message-1'],
    sensitive: false,
    status,
  };
}

/**
 * «Пульт» рисует кольцо «68 из 100» и четыре шкалы, ни одна из которых не
 * измерена. Правило продукта запрещает показывать оценку без источника,
 * выборки и даты (находка 8 аудита B178). Поэтому оценка здесь — только то,
 * что можно пересчитать по досье кандидата, и каждая мера называет, из чего
 * она сложена.
 */
describe('assessProfile', () => {
  it('считает заполненными только те разделы, где есть подтверждённый факт', () => {
    const assessment = assessProfile({
      memory: [
        fact('m1', 'responsibility', 'Отвечал за сквозную аналитику продукта.'),
        fact('m2', 'outcome', 'Сократил срок релиза на 30%.'),
        // Предложенный факт разделa не заполняет: его никто не подтвердил.
        fact('m3', 'skill', 'SQL и Python.', 'proposed'),
      ],
      targetDirection: 'Продуктовый аналитик',
    });

    const filled = measure(assessment, 'sections');
    expect(filled.value).toBe(2);
    expect(filled.total).toBe(4);
    expect(filled.basis).toContain('подтверждённ');
  });

  it('называет результат измеримым только когда в нём есть число', () => {
    const assessment = assessProfile({
      memory: [
        fact('m1', 'outcome', 'Сократил срок релиза на 30%.'),
        fact('m2', 'outcome', 'Участвовал в запуске новых направлений.'),
      ],
      targetDirection: '',
    });

    const measurable = measure(assessment, 'measurable-results');
    expect(measurable.value).toBe(1);
    expect(measurable.total).toBe(2);
  });

  it('не выдаёт ни одной меры, пока досье пустое', () => {
    const assessment = assessProfile({ memory: [], targetDirection: '' });

    expect(assessment.measures).toEqual([]);
    expect(assessment.measuredAt).toBeUndefined();
  });

  it('датирует пересчёт последним изменением досье, а не «сейчас»', () => {
    const updated = {
      ...fact('m1', 'outcome', 'Сократил срок релиза на 30%.'),
      updatedAt: '2026-08-30T09:15:00.000Z',
    };
    const older = {
      ...fact('m2', 'skill', 'SQL.'),
      updatedAt: '2026-08-14T09:15:00.000Z',
    };

    const assessment = assessProfile({
      memory: [older, updated],
      targetDirection: '',
    });

    expect(assessment.measuredAt).toBe('2026-08-30T09:15:00.000Z');
  });

  it('несёт версию метода, чтобы число можно было пересчитать', () => {
    const assessment = assessProfile({
      memory: [fact('m1', 'outcome', 'Сократил срок релиза на 30%.')],
      targetDirection: '',
    });

    expect(assessment.methodVersion).toBe(ASSESSMENT_METHOD_VERSION);
  });
});

function measure(assessment: ProfileAssessment, id: string) {
  const found = assessment.measures.find((item) => item.id === id);
  if (!found) throw new Error(`нет меры ${id}`);
  return found;
}
