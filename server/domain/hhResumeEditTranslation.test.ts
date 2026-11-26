import { describe, expect, it, vi } from 'vitest';
import { localizeHhResumeEdits, TRANSLATED_LINES_MAX } from './hhResumeEditTranslation';
import type { BulletTranslationRequest } from './experienceBulletLanguage';
import type { HhEditDraft } from './hhResumeEdits';

const drafts: HhEditDraft[] = [
  { id: 'title', section: 'title', was: 'Директор', now: 'COO', language: 'en' },
  {
    id: 'experience:0',
    section: 'experience',
    place: 'Россети Цифра · 2023 — 2025',
    employer: 'Россети Цифра',
    position: 'Директор по поддержке',
    was: 'Поддержка',
    now: 'Grew revenue from 230 to 920 mln rub.\nRebuilt the support team.',
    language: 'en',
    lines: ['Grew revenue from 230 to 920 mln rub.', 'Rebuilt the support team.'],
  },
  { id: 'about', section: 'about', was: 'Руковожу', now: 'Руковожу операциями.', language: 'ru' },
];

const RU: Record<string, string> = {
  'Grew revenue from 230 to 920 mln rub.': 'Выручка выросла с 230 до 920 млн руб.',
  'Rebuilt the support team.': 'Пересобрал команду поддержки.',
};

function translator(answers: Record<string, string>) {
  return {
    translate: vi.fn(async (request: BulletTranslationRequest) => ({
      bullets: request.bullets.flatMap((bullet) => (answers[bullet.text] ? [{ key: bullet.key, text: answers[bullet.text]! }] : [])),
    })),
  };
}

describe('B678: «станет» на языке резюме hh.ru', () => {
  it('переводит строки опыта одним запросом на правку; должность и текст на нужном языке остаются как есть', async () => {
    const ru = translator(RU);
    const edits = await localizeHhResumeEdits(drafts, 'ru', ru, 1_000);
    expect(ru.translate).toHaveBeenCalledTimes(1);
    expect(edits).toEqual([
      { id: 'title', section: 'title', was: 'Директор', now: 'COO' },
      {
        id: 'experience:0',
        section: 'experience',
        place: 'Россети Цифра · 2023 — 2025',
        employer: 'Россети Цифра',
        position: 'Директор по поддержке',
        was: 'Поддержка',
        now: 'Выручка выросла с 230 до 920 млн руб.\nПересобрал команду поддержки.',
      },
      { id: 'about', section: 'about', was: 'Руковожу', now: 'Руковожу операциями.' },
    ]);
  });

  it('перевод с числом, которого нет в исходном тексте, отбрасывает всю правку', async () => {
    const lying = translator({ ...RU, 'Rebuilt the support team.': 'Пересобрал команду поддержки из 40 человек.' });
    const edits = await localizeHhResumeEdits(drafts, 'ru', lying, 1_000);
    expect(edits.map((edit) => edit.id)).toEqual(['title', 'about']);
  });

  it('без переводчика правки на другом языке не показываются', async () => {
    const edits = await localizeHhResumeEdits(drafts, 'ru', undefined, 1_000);
    expect(edits.map((edit) => edit.id)).toEqual(['title', 'about']);
  });

  it(`переводится не больше ${TRANSLATED_LINES_MAX} строк: правки сверх потолка не показываются`, async () => {
    const line = 'Rebuilt the support team.';
    const big = (id: string, count: number): HhEditDraft => ({
      id, section: 'experience', was: '', now: '', language: 'en', lines: Array.from({ length: count }, () => line),
    });
    const ru = translator(RU);
    const size = TRANSLATED_LINES_MAX / 4;
    const drafts = Array.from({ length: 5 }, (_, index) => big(`experience:${index}`, size));
    const edits = await localizeHhResumeEdits(drafts, 'ru', ru, 1_000);
    expect(edits.map((edit) => edit.id)).toEqual(['experience:0', 'experience:1', 'experience:2', 'experience:3']);
    const sent = ru.translate.mock.calls.reduce((total, [request]) => total + request.bullets.length, 0);
    expect(sent).toBe(TRANSLATED_LINES_MAX);
  });
});
