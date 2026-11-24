import { describe, expect, it, vi } from 'vitest';
import type { BulletTranslationRequest } from './experienceBulletLanguage';
import { documentLang, translateDocument, translatedDocument } from './resumeTranslation';
import type { ResumeDocument } from './resumeStudioTypes';

const item = (value: string) => ({ value, memoryId: 'm', sourceMessageIds: [], reviewFlags: [] });
const document = {
  targetRole: 'Руководитель разработки',
  contact: { fullName: 'Марина Соколова', location: 'Москва', links: [] },
  about: 'Руковожу платформой восемь лет',
  experience: [
    {
      id: 'e',
      title: item('Руководитель группы'),
      employer: item('Финтех Лаб'),
      location: null,
      bullets: [item('Команда из 9 человек занималась платформой'), item('Go, Kotlin, PostgreSQL')],
    },
  ],
  skills: [
    { id: 's', name: 'Kubernetes' },
    { id: 't', name: 'найм' },
  ],
  education: [],
  languages: [],
} as unknown as ResumeDocument;

const EN: Record<string, string> = {
  'Руководитель разработки': 'Head of Development',
  Москва: 'Moscow',
  'Руковожу платформой восемь лет': 'Head of the platform for eight years',
  'Руководитель группы': 'Team Lead',
  'Команда из 9 человек занималась платформой': 'A team of 9 people worked on the platform',
  найм: 'hiring',
};
const translator = (answers: Record<string, string>) => ({
  translate: vi.fn(async ({ bullets }: BulletTranslationRequest) => ({
    bullets: bullets.flatMap(({ key, text }) =>
      answers[text] === undefined ? [] : [{ key, text: answers[text] }],
    ),
  })),
});
const run = (answers: Record<string, string>, known = {}) =>
  translateDocument(document, 'en', known, translator(answers), 5_000);

describe('перевод резюме под вакансию (B785)', () => {
  it('переводит строки, имена и компании пишет латиницей, технологии не трогает', async () => {
    const rewriter = translator(EN);
    const result = await translateDocument(document, 'en', {}, rewriter, 5_000);
    expect(result.complete).toBe(true);
    const text = JSON.stringify(translatedDocument(document, 'en', result.translations));
    expect(text).not.toMatch(/[а-яё]/iu);
    expect(text).toContain('Marina Sokolova');
    expect(text).toContain('Fintekh Lab');
    expect(text).toContain('Go, Kotlin, PostgreSQL');
    expect(JSON.stringify(rewriter.translate.mock.calls)).not.toContain('Соколова');
    expect(documentLang(document)).toBe('ru');
    expect(translatedDocument(document, 'ru', result.translations)).toBe(document);
  });

  it('строка с новым числом в перевод не входит', async () => {
    const key = 'Команда из 9 человек занималась платформой';
    const result = await run({ ...EN, [key]: 'A team of 19 people worked on the platform' });
    const place = translatedDocument(document, 'en', result.translations).experience[0]!;
    expect(result.complete).toBe(true);
    expect(place.bullets.map((bullet) => bullet.value)).toEqual(['Go, Kotlin, PostgreSQL']);
  });

  it('молчание переводчика: документ прежний, повтор просит только недостающее', async () => {
    const { найм: hiring, ...rest } = EN;
    const first = await run(rest);
    expect(first.complete).toBe(false);
    expect(translatedDocument(document, 'en', first.translations)).toBe(document);
    const second = await run({ найм: hiring! }, first.translations);
    expect(second.complete).toBe(true);
    expect((await translateDocument(document, 'en', {}, undefined, 10)).complete).toBe(false);
  });

  it('почти всё отклонено: перевода нет', async () => {
    const bad = Object.fromEntries(Object.keys(EN).map((key) => [key, 'по-русски']));
    expect((await run(bad)).complete).toBe(false);
  });
});
