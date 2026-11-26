import { describe, expect, it } from 'vitest';
import type { BulletTranslationRequest } from './experienceBulletLanguage';
import type { HhEditDraft } from './hhResumeEdits';
import { localizeHhResumeEditsDetailed } from './hhResumeEditTranslation';

const draft: HhEditDraft = {
  id: 'experience:0',
  section: 'experience',
  place: 'Fishance · 2020 — 2023',
  employer: 'Fishance',
  position: 'CTO',
  was: 'Старый текст',
  now: 'Built the platform.',
  language: 'en',
  lines: ['Built the platform.'],
};

/** Перевод, который приходит после срока ожидания экрана. */
function lateTranslator(delayMs: number) {
  return {
    translate: async (request: BulletTranslationRequest) => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return {
        bullets: request.bullets.map((bullet) => ({
          key: bullet.key,
          text: 'Построил платформу.',
        })),
      };
    },
  };
}

describe('B787: перевод правок, не уложившийся в срок', () => {
  it('в срок — полный результат', async () => {
    const result = await localizeHhResumeEditsDetailed([draft], 'ru', lateTranslator(1), 500);
    expect(result.complete).toBe(true);
    expect(result.edits.map((edit) => edit.now)).toEqual(['Построил платформу.']);
  });

  it('после срока — неполный ответ сейчас и все правки, когда перевод дойдёт', async () => {
    const result = await localizeHhResumeEditsDetailed([draft], 'ru', lateTranslator(60), 10);
    expect(result.complete).toBe(false);
    expect(result.edits).toEqual([]);
    expect((await result.settled).map((edit) => edit.now)).toEqual(['Построил платформу.']);
  });
});
