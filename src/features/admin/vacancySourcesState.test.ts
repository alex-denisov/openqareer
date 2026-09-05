import { describe, expect, it } from 'vitest';
import {
  sourcesFailure,
  sourcesLoaded,
  sourcesLoading,
  type VacancySourcesState,
} from './vacancySourcesState';

/**
 * B207 — отказ загрузки списка площадок обязан быть назван. До этого любая
 * ошибка глушилась пустым `catch`, и провал маршрута выглядел на экране ровно
 * так же, как честный ответ «источников нет».
 */
describe('B207 · состояние списка площадок', () => {
  it('начинается с загрузки, а не с пустого готового списка', () => {
    expect(sourcesLoading()).toEqual({ status: 'loading' });
  });

  it('называет причину отказа словами сервера', () => {
    const state = sourcesFailure(new Error('Слишком много запросов. Повторите через 8 минут.'));

    expect(state).toEqual({
      status: 'failed',
      message: 'Слишком много запросов. Повторите через 8 минут.',
    });
  });

  it('не выдаёт нечитаемую причину за сообщение', () => {
    const state = sourcesFailure({ weird: true });

    expect(state?.status).toBe('failed');
    expect((state as { message: string }).message).toBe('Не удалось загрузить список площадок.');
  });

  it('отменённый запрос отказом не считается', () => {
    // Размонтирование экрана обрывает свой же запрос через AbortController.
    // Это не событие сервера, и показывать его администратору нечестно.
    const aborted = new DOMException('The operation was aborted.', 'AbortError');

    expect(sourcesFailure(aborted)).toBeNull();
  });

  it('пустой список — это готовый ответ, а не отказ', () => {
    const state: VacancySourcesState = sourcesLoaded([]);

    expect(state).toEqual({ status: 'ready', sources: [] });
  });
});
