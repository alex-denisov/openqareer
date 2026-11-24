import { describe, expect, it } from 'vitest';
import { builderResumeSchema } from '../../../../../shared/resumeBuilder/model';
import type { ResumeDocument } from '../../../resume/resumeTypes';
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
