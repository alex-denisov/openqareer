import { describe, expect, it, vi } from 'vitest';
import type { BulletTranslationRequest } from './experienceBulletLanguage';
import { quantitiesOf } from './resumeTranslationCheck';
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

  it('строка с новым числом остаётся исходной', async () => {
    const key = 'Команда из 9 человек занималась платформой';
    const result = await run({ ...EN, [key]: 'A team of 19 people worked on the platform' });
    const place = translatedDocument(document, 'en', result.translations).experience[0]!;
    expect(result.complete).toBe(true);
    expect(place.bullets.map((bullet) => bullet.value)).toEqual([key, 'Go, Kotlin, PostgreSQL']);
  });

  it('строка без ответа остаётся исходной, повтор просит только её', async () => {
    const { найм: hiring, ...rest } = EN;
    const first = await run(rest);
    expect(first.complete).toBe(true);
    expect(translatedDocument(document, 'en', first.translations).skills?.[1]?.name).toBe('найм');
    const rewriter = translator({ найм: hiring! });
    const second = await translateDocument(document, 'en', first.translations, rewriter, 5_000);
    expect(rewriter.translate).toHaveBeenCalledTimes(1);
    expect(translatedDocument(document, 'en', second.translations).skills?.[1]?.name).toBe(
      'hiring',
    );
  });

  it('переводчик молчит: документ прежний', async () => {
    const result = await translateDocument(document, 'en', {}, undefined, 10);
    expect(result.complete).toBe(false);
    expect(translatedDocument(document, 'en', result.translations)).toBe(document);
  });

  it('почти всё отклонено: перевода нет', async () => {
    const bad = Object.fromEntries(Object.keys(EN).map((key) => [key, 'по-русски']));
    expect((await run(bad)).complete).toBe(false);
  });
});

const VK = 'Head of Technical Support and Customer Success, VK Cloud Platform';
const OPTILAB = [
  'Founded the AI practice and 3 product teams',
  'Improved multi-agent pipelines, cutting cycle time by 40%',
  'Run 12 pilots for enterprise customers',
  'Responsible for pre-sales worth $1.2M',
  'Implementation of OptiLab platform in 5 regions',
];
const ROSSETI = 'Grew service revenue from RUB 230M to 920M and won 14 tenders';
const english = {
  targetRole: 'Head of Support',
  contact: { fullName: 'Alex Sample', location: 'Moscow', links: [] },
  about: null,
  experience: [
    {
      id: 'o',
      title: item('Founder'),
      employer: item('OptiLab'),
      location: null,
      bullets: OPTILAB.map(item),
    },
    {
      id: 'v',
      title: item(VK),
      employer: item('VK'),
      location: null,
      bullets: [item('Led 60 engineers, SLA 99.9%')],
    },
    {
      id: 'r',
      title: item('Premium Support Lead'),
      employer: item('Rosseti'),
      location: null,
      bullets: [item(ROSSETI)],
    },
  ],
  education: [
    {
      id: 'd',
      institution: item('Moscow State University'),
      qualification: item('MSc Computer Science'),
      startDate: null,
      endDate: null,
    },
  ],
  languages: [
    { id: 'en', name: item('English'), cefr: item('C1') },
    { id: 'ru', name: item('Russian'), cefr: item('C2') },
  ],
} as unknown as ResumeDocument;
const RU: Record<string, string> = {
  'Head of Support': 'Руководитель поддержки',
  Moscow: 'Москва',
  Founder: 'Основатель',
  [VK]: 'Руководитель технической поддержки и клиентского успеха, VK Cloud Platform',
  'Premium Support Lead': 'Руководитель премиальной поддержки',
  'MSc Computer Science': 'Магистр компьютерных наук',
  [OPTILAB[0]!]: 'Основал практику ИИ и 3 продуктовые команды',
  [OPTILAB[1]!]: 'Разработал мультиагентные пайплайны и сократил цикл на 40%',
  [OPTILAB[2]!]: 'Запустил 12 пилотов для корпоративных клиентов',
  [OPTILAB[3]!]: 'Отвечал за предпродажи на 1,2 млн $',
  [OPTILAB[4]!]: 'Внедрение платформы OptiLab в 5 регионах',
  'Led 60 engineers, SLA 99.9%': 'Руководил 60 инженерами, SLA 99,9%',
  [ROSSETI]: 'Увеличил выручку сервиса с 230 млн до 920 млн руб. и выиграл 14 тендеров',
};
const toRu = (answers: Record<string, string>, known = {}) =>
  translateDocument(english, 'ru', known, translator(answers), 5_000);
const facts = (document: ResumeDocument) =>
  document.experience.map((place) => ({
    employer: place.employer?.value,
    titled: Boolean(place.title?.value),
    bullets: place.bullets.map((bullet) => quantitiesOf(bullet.value)),
  }));

describe('RU и EN — один состав фактов (B785)', () => {
  it('множество чисел и мест RU = EN, всё переведено, компании прежние', async () => {
    const result = await toRu(RU);
    const russian = translatedDocument(english, 'ru', result.translations);
    expect(facts(russian)).toEqual(facts(english));
    expect(russian.experience.map((place) => place.title?.value)).toEqual([
      'Основатель',
      RU[VK],
      'Руководитель премиальной поддержки',
    ]);
    expect(russian.experience.flatMap((place) => place.bullets.map(({ value }) => value))).toEqual(
      [...OPTILAB, 'Led 60 engineers, SLA 99.9%', ROSSETI].map((line) => RU[line]),
    );
    expect(russian.languages.map((language) => language.name?.value)).toEqual([
      'Английский',
      'Русский',
    ]);
    expect(russian.education[0]?.qualification?.value).toBe('Магистр компьютерных наук');
    expect(russian.contact.location).toBe('Москва');
  });

  it.each([
    ['другой факт вместо выручки', 'Увеличил выручку сервиса и выиграл 14 тендеров'],
    ['другой масштаб', RU[ROSSETI]!.replace('920 млн', '920 тыс.')],
    ['другая валюта', RU[ROSSETI]!.replace('руб.', '$')],
  ])('%s: строка остаётся исходной', async (_, answer) => {
    const result = await toRu({ ...RU, [ROSSETI]: answer });
    const russian = translatedDocument(english, 'ru', result.translations);
    expect(russian.experience[2]?.bullets[0]?.value).toBe(ROSSETI);
    expect(facts(russian)).toEqual(facts(english));
  });

  it('пустой или неточный перевод, сохранённый раньше, спрашивается заново', async () => {
    const result = await toRu(RU);
    const old = { ...result.translations, [`ru:${VK}`]: '', [`ru:${ROSSETI}`]: 'Выиграл тендеры' };
    expect(translatedDocument(english, 'ru', old).experience[1]?.title?.value).toBe(VK);
    const rewriter = translator(RU);
    const again = await translateDocument(english, 'ru', old, rewriter, 5_000);
    expect(rewriter.translate).toHaveBeenCalledTimes(2);
    expect(again.translations).toEqual(result.translations);
  });

  it('должность, сохранённая непереведённой, спрашивается снова', async () => {
    const result = await toRu({ ...RU, 'Premium Support Lead': 'Premium Support Lead' });
    expect(
      translatedDocument(english, 'ru', result.translations).experience[2]?.title?.value,
    ).toBe('Premium Support Lead');
    const rewriter = translator(RU);
    const again = await translateDocument(english, 'ru', result.translations, rewriter, 5_000);
    expect(rewriter.translate).toHaveBeenCalledTimes(1);
    expect(translatedDocument(english, 'ru', again.translations).experience[2]?.title?.value).toBe(
      RU['Premium Support Lead'],
    );
  });

  it('название компании переводить нельзя', async () => {
    const line = OPTILAB[4]!;
    const result = await toRu({ ...RU, [line]: 'Внедрение платформы ОптиЛаб в 5 регионах' });
    expect(
      translatedDocument(english, 'ru', result.translations).experience[0]?.bullets[4]?.value,
    ).toBe(line);
  });

  it.each([
    ['$230M, 40,000 users, 5%', '230 млн $, 40 000 пользователей, 5 %'],
    ['1.5 billion over 3 years', '1,5 млрд за 3 года'],
    ['10 employees, 5 months, 3 bn', '10 сотрудников, 5 месяцев, 3 млрд'],
    ['1,234,567 events in 2023–2024', '1 234 567 событий в 2023–2024'],
  ])('числа «%s» = «%s»', (en, ru) => {
    expect(quantitiesOf(en)).toEqual(quantitiesOf(ru));
  });
});
