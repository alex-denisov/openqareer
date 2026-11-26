import { describe, expect, it } from 'vitest';
import type { HhEditDraft } from './hhResumeEdits';
import { localizeHhResumeEditsDetailed } from './hhResumeEditTranslation';

/** B787: обезличенная форма живого разбора 138865937 — английский профиль, русское резюме hh.ru. */
const place: HhEditDraft = {
  id: 'experience:0',
  section: 'experience',
  place: 'Компания А · 2021 — 2024',
  employer: 'Компания А',
  position: 'CTO',
  was: 'Рост рентабельности с 16% до 80%.',
  now: 'Grew revenue from 230 to 920 million rubles (+300%).\nImproved profitability from 16% to 40% through automation.',
  lines: [
    'Grew revenue from 230 to 920 million rubles (+300%).',
    'Improved profitability from 16% to 40% through automation.',
  ],
  language: 'en',
};
const paragraph = (index: number) =>
  `Built support platforms for ${index + 10} clients across regions and teams. `.repeat(4).trim();
const aboutParagraphs = [
  'I build and transform technology organizations.',
  'Executive Leadership | P&L Ownership ($50M+)',
  ...Array.from({ length: 8 }, (_, i) => paragraph(i)),
  '📫 Contact: name@example.com | Telegram: @name',
];
const about: HhEditDraft = {
  id: 'about',
  section: 'about',
  was: 'Старый текст.',
  now: aboutParagraphs.join('\n'),
  language: 'en',
};

const RU: Record<string, string> = {
  'Grew revenue from 230 to 920 million rubles (+300%).':
    'Увеличил выручку с 230 до 920 млн рублей (+300%).',
  'Improved profitability from 16% to 40% through automation.':
    'Увеличил рентабельность с 16% до 40% за счёт автоматизации.',
  'I build and transform technology organizations.':
    'Я создаю и трансформирую технологические организации.',
  'Executive Leadership | P&L Ownership ($50M+)':
    'Руководство на уровне топ-менеджмента | Ответственность за P&L (50+ млн $)',
  '📫 Contact: name@example.com | Telegram: @name':
    '📫 Контакты: name@example.com | Telegram: @name',
};
const translated = (text: string) =>
  RU[text] ??
  text.replace(
    /Built support platforms for (\d+) clients across regions and teams\./gu,
    'Построил платформы поддержки для $1 клиентов в регионах и командах.',
  );

describe('B787: правки живого разбора доходят до показа', () => {
  it('«Grew…» опыта и длинное «О себе» абзацами переводятся и показываются', async () => {
    expect(about.now.length).toBeGreaterThan(1000);
    const requests: number[] = [];
    const translator = {
      translate: async (request: {
        bullets: ReadonlyArray<{ key: string; text: string; line?: string }>;
      }) => {
        requests.push(...request.bullets.map((bullet) => bullet.text.length));
        expect(request.bullets.every((bullet) => bullet.line === 'text')).toBe(true);
        return {
          bullets: request.bullets.map((bullet) => ({
            key: bullet.key,
            text: translated(bullet.text),
          })),
        };
      },
    };
    const result = await localizeHhResumeEditsDetailed(
      [place, about],
      'ru',
      translator as never,
      5_000,
    );
    expect(Math.max(...requests)).toBeLessThanOrEqual(1000);
    expect(result.edits.map((edit) => edit.id)).toEqual(['experience:0', 'about']);
    expect(result.edits[0]!.now).toContain('с 16% до 40%');
    expect(result.edits[1]!.now.split('\n')).toHaveLength(aboutParagraphs.length);
  });
});
