import { describe, expect, it } from 'vitest';
import { parseDescriptionSections } from './vacancyDescriptionSections';

describe('parseDescriptionSections (B549)', () => {
  it('splits hh-style text into intro and canonical sections', () => {
    const text = [
      'Команда платежей, 40 человек.',
      '',
      'Обязанности:',
      '- Развитие платёжной платформы',
      '- Найм руководителей',
      '',
      'Требования:',
      '• 8+ лет в разработке',
      '',
      'Мы предлагаем:',
      'ДМС с первого дня',
      'Гибрид',
    ].join('\n');
    expect(parseDescriptionSections(text)).toEqual({
      intro: ['Команда платежей, 40 человек.'],
      sections: [
        {
          title: 'Чем предстоит заниматься',
          items: ['Развитие платёжной платформы', 'Найм руководителей'],
          bullets: [true, true],
        },
        { title: 'Что мы ждём', items: ['8+ лет в разработке'], bullets: [true] },
        { title: 'Условия', items: ['ДМС с первого дня', 'Гибрид'], bullets: [false, false] },
      ],
    });
  });

  it('keeps unknown headings verbatim', () => {
    const parsed = parseDescriptionSections('О проекте:\nНовый банк\n\nЗадачи:\n1. Строить');
    expect(parsed?.sections).toEqual([
      { title: 'О проекте', items: ['Новый банк'], bullets: [false] },
      { title: 'Чем предстоит заниматься', items: ['Строить'], bullets: [true] },
    ]);
  });

  it('returns null when there are no headings', () => {
    expect(parseDescriptionSections('Просто текст вакансии без разделов.')).toBeNull();
    expect(parseDescriptionSections('')).toBeNull();
  });

  it('does not treat a long sentence ending with a colon as a heading', () => {
    const text =
      'Мы ищем руководителя, который возьмёт на себя развитие всей платёжной платформы и команды:\n- найм';
    expect(parseDescriptionSections(text)).toBeNull();
  });
});
