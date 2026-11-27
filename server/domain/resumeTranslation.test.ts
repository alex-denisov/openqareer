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

  it('должность, сохранённая непереведённой раньше, спрашивается ещё один раз', async () => {
    const title = 'Premium Support Lead';
    const old = { ...(await toRu(RU)).translations, [`ru:${title}`]: title };
    const rewriter = translator(RU);
    const again = await translateDocument(english, 'ru', old, rewriter, 5_000);
    expect(rewriter.translate).toHaveBeenCalledTimes(1);
    expect(translatedDocument(english, 'ru', again.translations).experience[2]?.title?.value).toBe(
      RU[title],
    );
  });

  it('должность, оставленная как есть, второй раз не спрашивается', async () => {
    const title = 'Premium Support Lead';
    const result = await toRu({ ...RU, [title]: title });
    expect(result.complete).toBe(true);
    const rewriter = translator(RU);
    const again = await translateDocument(english, 'ru', result.translations, rewriter, 5_000);
    expect(rewriter.translate).not.toHaveBeenCalled();
    expect(again.complete).toBe(true);
    expect(translatedDocument(english, 'ru', again.translations).experience[2]?.title?.value).toBe(
      title,
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

describe('один язык листа (Д17)', () => {
  const sheet = {
    ...english,
    experience: [
      {
        ...english.experience[2]!,
        employer: item('Россети Цифра'),
        bullets: [item('Joined Россети Цифра')],
      },
      ...english.experience.slice(0, 2),
    ],
    courses: [
      { id: 'c', name: 'Project Management', institution: 'Корпоративный университет Сбербанка' },
    ],
    projects: [
      {
        id: 'p',
        name: item('Support portal'),
        employer: null,
        description: item('Built e-therapy service'),
      },
      { id: 'q', name: item('e-therapy'), employer: null, description: null },
    ],
  } as unknown as ResumeDocument;

  it.each(['en', undefined] as const)(
    'английский лист без перевода (%s): названия латиницей',
    (lang) => {
      const result = translatedDocument(sheet, lang, {});
      const text = JSON.stringify(result);
      expect(text).not.toMatch(/[а-яё]/iu);
      expect(text).toContain('Joined Rosseti Tsifra');
      expect(text).toContain('Corporate University of Sberbank (SberUniversity)');
    },
  );

  it('написание кандидата важнее транслитерации, чужие буквы не меняются', () => {
    const moldova = {
      ...sheet,
      education: [
        { ...sheet.education[0]!, institution: item('Universitatea Tehnică a Moldovei') },
      ],
    } as unknown as ResumeDocument;
    const result = translatedDocument(moldova, 'en', {}, moldova, [
      'Rosseti Digital is the employer',
    ]);
    expect(result.experience[0]?.employer?.value).toBe('Rosseti Digital');
    expect(result.education[0]?.institution?.value).toBe('Universitatea Tehnică a Moldovei');
  });

  it('русский лист: курс и проект переведены, e-therapy остаётся', async () => {
    const answers = {
      ...RU,
      'Project Management': 'Управление проектами',
      'Support portal': 'Портал поддержки',
      'Built e-therapy service': 'Создал сервис e-therapy',
      'Joined Россети Цифра': 'Пришёл в Россети Цифра',
    };
    const result = await translateDocument(sheet, 'ru', {}, translator(answers), 5_000);
    const russian = translatedDocument(sheet, 'ru', result.translations);
    expect(russian.courses?.[0]?.name).toBe('Управление проектами');
    expect(russian.projects?.map(({ name }) => name.value)).toEqual([
      'Портал поддержки',
      'e-therapy',
    ]);
    expect(russian.projects?.[0]?.description?.value).toBe('Создал сервис e-therapy');
  });

  it('перевод, потерявший e-therapy, не берётся', async () => {
    const answers = { ...RU, 'Built e-therapy service': 'Создал сервис электронной терапии' };
    const result = await translateDocument(sheet, 'ru', {}, translator(answers), 5_000);
    const russian = translatedDocument(sheet, 'ru', result.translations);
    expect(russian.projects?.[0]?.description?.value).toBe('Built e-therapy service');
  });

  it('описательное название, сохранённое как есть, спрашивается ещё раз', async () => {
    const answers = { ...RU, 'Support portal': 'Портал поддержки' };
    const known = { 'ru:Support portal': 'Support portal' };
    const result = await translateDocument(sheet, 'ru', known, translator(answers), 5_000);
    expect(result.translations['ru:Support portal']).toBe('Портал поддержки');
  });

  it('e-therapy в пункте опыта не переводится, хотя такого проекта нет', async () => {
    const own = {
      ...sheet,
      experience: [{ ...sheet.experience[1]!, bullets: [item('Built e-therapy service')] }, ...sheet.experience.slice(1)],
      projects: [],
    } as unknown as ResumeDocument;
    const answers = { ...RU, 'Built e-therapy service': 'Создал сервис электронной терапии' };
    const result = await translateDocument(own, 'ru', {}, translator(answers), 5_000);
    expect(JSON.stringify(result.translations)).not.toContain('терапии');
  });

  const campus = (employer: string, startDate: string, endDate: string) =>
    ({
      ...sheet,
      experience: [
        {
          ...sheet.experience[0]!,
          title: item('IT Lead (Acting Head of IT)'),
          employer: item('Корпоративный университет Сбербанка'),
          startDate: item('Dec 2012'),
          endDate: item('Jul 2016'),
        },
        ...sheet.experience.slice(1),
      ],
      projects: [
        {
          ...sheet.projects![0]!,
          employer: item(employer),
          startDate: item(startDate),
          endDate: item(endDate),
        },
      ],
    }) as unknown as ResumeDocument;
  const UNIVERSITY = 'Corporate University of a Top-Tier Financial Institution';
  const ANSWERS = { ...RU, 'IT Lead (Acting Head of IT)': 'Руководитель направления ИТ (врио руководителя ИТ)' };

  it.each([
    [UNIVERSITY, 'Mar 2013', 'Sep 2015', 'Корпоративный университет Сбербанка', 'Corporate University of Sberbank (SberUniversity)'],
    [UNIVERSITY, 'Mar 2018', 'Sep 2019', UNIVERSITY, UNIVERSITY],
    ['Enterprise Energy IT Services', 'Mar 2013', 'Sep 2015', 'Enterprise Energy IT Services', 'Enterprise Energy IT Services'],
  ])('работодатель проекта %s, %s — %s', async (employer, from, to, shown, english) => {
    const own = campus(employer, from, to);
    const { translations } = await translateDocument(own, 'ru', {}, translator(ANSWERS), 5_000);
    expect(translatedDocument(own, 'ru', translations).projects?.[0]?.employer?.value).toBe(shown);
    expect(translatedDocument(own, 'en', translations).projects?.[0]?.employer?.value).toBe(english);
  });

  it('должность, переведённая наполовину, спрашивается заново', async () => {
    const own = campus(UNIVERSITY, 'Mar 2013', 'Sep 2015');
    const title = 'IT Lead (Acting Head of IT)';
    const known = { [`ru:${title}`]: 'IT Lead (исполняющий обязанности руководителя IT)' };
    const again = await translateDocument(own, 'ru', known, translator(ANSWERS), 5_000);
    expect(again.translations[`ru:${title}`]).toBe(ANSWERS[title]);
  });

  it('должность, потерявшая часть, спрашивается заново', async () => {
    const own = campus(UNIVERSITY, 'Mar 2013', 'Sep 2015');
    const title = 'IT Lead (Acting Head of IT)';
    const known = { [`ru:${title}`]: 'Врио руководителя ИТ' };
    const again = await translateDocument(own, 'ru', known, translator(ANSWERS), 5_000);
    expect(again.translations[`ru:${title}`]).toBe(ANSWERS[title]);
    const lost = await translateDocument(own, 'ru', known, translator({ ...ANSWERS, [title]: 'Врио руководителя ИТ' }), 5_000);
    expect(lost.translations[`ru:${title}`]).toBe(title);
  });
});
