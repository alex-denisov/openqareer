import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CoachApiError } from '../../coach/apiClient';
import { formOf } from './experienceForm';
import { addDescription, createFactWriter, dropUnusedDescription } from './experienceResults';
import { blankEntry, withNewEntry } from './newExperience';

/** Факты на сервере: ключ → текст; правила те же, что у маршрута experience-facts. */
const { facts, deleted, fail } = vi.hoisted(() => ({
  facts: new Map<string, string>(),
  deleted: new Set<string>(),
  fail: { lost: false },
}));

vi.mock('../../resume/experienceFactApi', () => ({
  addManualExperienceFact: async (input: { statement: string; idempotencyKey: string }) => {
    const known = facts.get(input.idempotencyKey);
    if (deleted.has(input.idempotencyKey) || (known !== undefined && known !== input.statement))
      throw new CoachApiError('Позиция изменилась', 'experience_fact_conflict', true);
    facts.set(input.idempotencyKey, input.statement);
    if (fail.lost) throw new Error('offline');
    return { id: input.idempotencyKey };
  },
}));
vi.mock('../../coach/coachApi', () => ({
  changeMemory: async (id: string, input: { action: string; statement?: string }) => {
    if (!facts.has(id)) throw new CoachApiError('Нет записи', 'memory_not_found', false);
    if (input.action === 'delete') {
      facts.delete(id);
      deleted.add(id);
    } else facts.set(id, input.statement ?? '');
  },
}));

beforeEach(() => {
  facts.clear();
  fail.lost = false;
});

const entry = blankEntry('e1');
const form = (description: string) => ({ ...formOf(entry), description });

describe('B801: «Что делали» после сбоя', () => {
  it('правка описания и повтор обновляют тот же факт', async () => {
    const writer = createFactWriter();
    const first = await addDescription(entry, form('Вёл команду'), writer);
    // Черновик не сохранился, кандидат поправил текст и нажал ещё раз.
    const second = await addDescription(entry, form('Вёл команду из 12'), writer);
    expect(second).toBe(first);
    expect([...facts]).toEqual([[first, 'Вёл команду из 12']]);
  });

  it('ответ потерялся: факт записан, повтор с другим текстом обновляет его', async () => {
    const writer = createFactWriter();
    fail.lost = true;
    await expect(addDescription(entry, form('Было'), writer)).rejects.toThrow('offline');
    fail.lost = false;
    const id = await addDescription(entry, form('Стало'), writer);
    expect([...facts]).toEqual([[id, 'Стало']]);
  });

  it('описание стёрли перед повтором: факта без места не остаётся', async () => {
    const writer = createFactWriter();
    await addDescription(entry, form('Было'), writer);
    const empty = form('');
    await dropUnusedDescription(empty, withNewEntry(null, entry, empty), writer);
    expect(await addDescription(entry, empty, writer)).toBeNull();
    expect(facts.size).toBe(0);
    await addDescription(entry, form('Снова'), writer);
    expect([...facts.values()]).toEqual(['Снова']);
  });

  it('чужой конфликт первой попытки не превращается в правку', async () => {
    const writer = createFactWriter();
    facts.set(writer.descriptionKey(), 'Чужое');
    await expect(addDescription(entry, form('Моё'), writer)).rejects.toThrow('Позиция');
    expect(facts.get(writer.descriptionKey())).toBe('Чужое');
  });

  it('строка «Результатов» с новым текстом после сбоя обновляет тот же факт', async () => {
    const writer = createFactWriter();
    await writer.add('r1', 'План 100 %', 'e1');
    await writer.add('r1', 'План 112 %', 'e1');
    expect([...facts]).toEqual([['r1', 'План 112 %']]);
  });
});
