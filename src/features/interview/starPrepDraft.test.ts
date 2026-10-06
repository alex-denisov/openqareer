import { describe, expect, it } from 'vitest';
import {
  editStarField,
  emptyStarPrepDraft,
  gapFields,
  isGapText,
  loadStarPrepDraft,
  saveStarPrepDraft,
  withBriefGaps,
} from './starPrepDraft';
import type { StarQuestion } from './interviewPrepEngine';

const question = (over: Partial<StarQuestion['starAnswer']> = {}): StarQuestion => ({
  id: 'star-q1-tech',
  category: 'technical',
  question: 'Опишите сложную задачу.',
  usedEvidenceIds: ['fact-1'],
  starAnswer: {
    situation:
      'Контекст ситуации в подтверждённых данных не зафиксирован; уточните его перед встречей.',
    task: 'Задача и критерии успеха в подтверждённых данных не зафиксированы; добавьте их при подготовке.',
    action: 'Перевёл платежи на очередь сообщений.',
    result:
      'Результат этого действия в профиле не зафиксирован; не называйте его измеренным без подтверждения.',
    ...over,
  },
});

describe('isGapText', () => {
  it('узнаёт заготовки пробелов из движка подготовки', () => {
    expect(isGapText(question().starAnswer.situation)).toBe(true);
    expect(isGapText(question().starAnswer.action)).toBe(false);
  });
});

describe('gapFields', () => {
  it('перечисляет поля STAR, где нет подтверждённых фактов', () => {
    expect(gapFields(question())).toEqual(['situation', 'task', 'result']);
  });
});

describe('editStarField', () => {
  it('возвращает новый черновик и не меняет исходный', () => {
    const draft = emptyStarPrepDraft('app-1');
    const next = editStarField(
      draft,
      'star-q1-tech',
      'situation',
      ' Платёжный сервис падал по пятницам ',
    );
    expect(next.edits['star-q1-tech']?.situation).toBe('Платёжный сервис падал по пятницам');
    expect(draft.edits['star-q1-tech']).toBeUndefined();
  });

  it('пустая правка снимает прежнюю', () => {
    const edited = editStarField(emptyStarPrepDraft('app-1'), 'q', 'task', 'текст');
    expect(editStarField(edited, 'q', 'task', '   ').edits.q?.task).toBeUndefined();
  });
});

describe('withBriefGaps', () => {
  it('подставляет правки кандидата и убирает пробел только у заполненного поля', () => {
    const draft = editStarField(
      emptyStarPrepDraft('app-1'),
      'star-q1-tech',
      'situation',
      'Падал сервис',
    );
    const merged = withBriefGaps([question()], draft);
    expect(merged[0]?.starAnswer.situation).toBe('Падал сервис');
    expect(merged[0]?.unresolved).toEqual(['task', 'result']);
    expect(merged[0]?.usedEvidenceIds).toEqual(['fact-1']);
  });
});

describe('хранение на отклик', () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };

  it('сохраняет и читает подготовку по отклику', () => {
    const draft = editStarField(
      emptyStarPrepDraft('app-9'),
      'q',
      'result',
      'Сократил простой на 40 %',
    );
    saveStarPrepDraft(draft, storage);
    expect(loadStarPrepDraft('app-9', storage).edits.q?.result).toBe('Сократил простой на 40 %');
    expect(loadStarPrepDraft('app-other', storage).edits).toEqual({});
  });

  it('битые данные в хранилище не ломают экран', () => {
    store.set('oq-star-prep:app-bad', '{не json');
    expect(loadStarPrepDraft('app-bad', storage).edits).toEqual({});
  });

  it('недоступное хранилище не бросает ошибку', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadStarPrepDraft('app-1', broken).edits).toEqual({});
    expect(() => saveStarPrepDraft(emptyStarPrepDraft('app-1'), broken)).not.toThrow();
  });
});
