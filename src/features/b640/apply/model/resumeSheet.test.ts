import { describe, expect, it } from 'vitest';
import { builderResumeSchema } from '../../../../../shared/resumeBuilder/model';
import type { ResumeDocument } from '../../../resume/resumeTypes';
import { translatedDocument } from '../../../../../server/domain/resumeTranslation';
import { sheetFromDocument } from './resumeSheet';

const a = <T extends string | boolean>(value: T) => ({
  value,
  memoryId: 'm',
  sourceMessageIds: [],
  reviewFlags: [],
});

const document = {
  targetRole: 'Head of Engineering',
  contact: {
    fullName: 'Марина Соколова',
    email: 'm@example.test',
    phone: null,
    location: 'Москва',
    links: ['https://www.linkedin.com/in/msokolova/'],
  },
  about: 'Руковожу платформой',
  experience: [
    {
      id: 'e',
      title: a('Руководитель'),
      employer: a('Финтех Лаб'),
      location: a('Москва'),
      startDate: a('2021'),
      endDate: null,
      current: a(true),
      description: a('- Вела бэкенд\nСтек: Go'),
      bullets: [a('Команда из 9 человек'), a('Стек: Go')],
    },
  ],
  education: [
    {
      id: 'd',
      institution: a('МГТУ'),
      qualification: null,
      startDate: null,
      endDate: a('2014-06'),
    },
  ],
  skills: [{ id: 's', name: 'Go' }],
  languages: [
    { id: 'l1', name: a('Русский'), cefr: null, native: a('native') },
    { id: 'l2', name: a('Английский'), cefr: a('C1') },
  ],
  courses: [{ id: 'c', name: 'Kafka', year: 2023 }],
} as unknown as ResumeDocument;

describe('sheetFromDocument (B785)', () => {
  it('переносит факты документа, «О себе» и языки в поля файла', () => {
    const sheet = sheetFromDocument(document);
    expect(sheet).toMatchObject({
      link: 'linkedin.com/in/msokolova',
      about: 'Руковожу платформой',
      languages: 'Русский (родной), Английский (C1)',
      extra: [{ title: 'Курсы', lines: ['Kafka, 2023'] }],
      education: [{ school: 'МГТУ', year: '2014' }],
      jobs: [
        {
          start: '2021',
          end: '',
          current: true,
          bullets: ['Вела бэкенд', 'Стек: Go', 'Команда из 9 человек'],
        },
      ],
    });
    expect(builderResumeSchema.safeParse(sheet).success).toBe(true);
  });

  it('английский текст — английские заголовки (B713)', () => {
    const entry = document.experience[0]!;
    const sheet = sheetFromDocument({
      ...document,
      about: 'I lead platform teams',
      experience: [
        { ...entry, title: a('Head of Platform'), description: null, bullets: [a('Led 9 people')] },
      ],
    });
    expect(sheet.lang).toBe('en');
    expect(sheet.languages).toContain('(native)');
    expect(sheetFromDocument(document).lang).toBe('ru');
  });

  it('длинные поля не ломают схему файла', () => {
    const sheet = sheetFromDocument({ ...document, about: 'я'.repeat(9_000) });
    expect(builderResumeSchema.safeParse(sheet).success).toBe(true);
  });
});

describe('лист на другом языке (B785)', () => {
  it('непереведённая строка и все числа остаются в полях PDF и DOCX', () => {
    const bullets = [
      'Grew revenue from $230M to $920M and won 14 tenders',
      'Built an AI practice with 3 teams',
      'Ran 12 enterprise pilots',
    ];
    const english = {
      targetRole: 'Head of Support',
      contact: { fullName: 'Alex Sample', email: null, phone: null, location: null, links: [] },
      experience: [
        {
          id: 'e',
          title: a('Premium Support Lead'),
          employer: a('OptiLab'),
          location: null,
          startDate: a('2021'),
          endDate: null,
          current: a(true),
          bullets: bullets.map(a),
        },
      ],
      education: [],
      languages: [{ id: 'l', name: a('English'), cefr: a('C1') }],
    } as unknown as ResumeDocument;
    const sheet = sheetFromDocument(
      translatedDocument(english, 'ru', {
        'ru:Head of Support': 'Руководитель поддержки',
        'ru:Premium Support Lead': 'Руководитель премиальной поддержки',
        [`ru:${bullets[0]}`]: 'Увеличил выручку с 230 млн $ до 920 млн $ и выиграл 14 тендеров',
        [`ru:${bullets[1]}`]: 'Создал практику ИИ из 3 команд',
        [`ru:${bullets[2]}`]: 'Провёл пилоты',
      }),
    );
    expect(sheet.jobs[0]).toMatchObject({
      company: 'OptiLab',
      role: 'Руководитель премиальной поддержки',
    });
    expect(sheet.jobs[0]?.bullets.map((item) => item.match(/\d+/gu))).toEqual(
      bullets.map((item) => item.match(/\d+/gu)),
    );
    expect(sheet.jobs[0]?.bullets[2]).toBe(bullets[2]);
    expect(sheet.languages).toBe('Английский (C1)');
    expect(builderResumeSchema.safeParse(sheet).success).toBe(true);
  });
});
