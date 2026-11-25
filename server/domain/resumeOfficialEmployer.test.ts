import { describe, expect, it } from 'vitest';
import { translateDocument, translatedDocument } from './resumeTranslation';
import type { ResumeDocument } from './resumeStudioTypes';

const item = (value: string) => ({ value, memoryId: 'm', sourceMessageIds: [], reviewFlags: [] });
const RUSSIAN = 'Корпоративный университет Сбербанка';
const OFFICIAL = 'Corporate University of Sberbank (SberUniversity)';

const sheet = (title: string, bullet: string) =>
  ({
    targetRole: null,
    contact: { fullName: 'Marina', location: null, links: [] },
    about: null,
    experience: [
      {
        id: 'e',
        title: item(title),
        employer: item(RUSSIAN),
        location: null,
        bullets: [item(bullet)],
      },
    ],
    skills: [],
    education: [],
    languages: [],
  }) as unknown as ResumeDocument;

const answer = (pairs: Record<string, string>) => ({
  translate: async ({ bullets }: { bullets: readonly { key: string; text: string }[] }) => ({
    bullets: bullets.map(({ key, text }) => ({ key, text: pairs[text] ?? text })),
  }),
});

const EN_TITLE = 'Head of Support';
const RU_TITLE = 'Руководитель поддержки';
const EN_LINE = 'Led a team of 9 support engineers';
const RU_LINE = 'Руководил командой из 9 инженеров поддержки';

describe('официальное английское название работодателя в резюме', () => {
  it.each([
    ['русский профиль', sheet(RU_TITLE, RU_LINE)],
    ['английский профиль', sheet(EN_TITLE, EN_LINE)],
  ])('%s: RU→EN→RU', async (_name, document) => {
    const pairs = {
      [RU_TITLE]: EN_TITLE,
      [RU_LINE]: EN_LINE,
      [EN_TITLE]: RU_TITLE,
      [EN_LINE]: RU_LINE,
    };
    const toRu = await translateDocument(document, 'ru', {}, answer(pairs), 5_000);
    const both = await translateDocument(document, 'en', toRu.translations, answer(pairs), 5_000);
    const show = (lang: 'ru' | 'en') => translatedDocument(document, lang, both.translations);
    const before = show('ru');
    const english = show('en');
    expect(before.experience[0]?.employer?.value).toBe(RUSSIAN);
    expect(english.experience[0]?.employer?.value).toBe(OFFICIAL);
    expect(JSON.stringify(english)).not.toMatch(/[а-яё]/iu);
    expect(show('ru')).toEqual(before);
  });
});
