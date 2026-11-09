import { describe, expect, it } from 'vitest';
import { letterSignatureName, letterTextLanguage, splitSignatureLine } from './letterSignature';

describe('letterTextLanguage (B624): язык письма по его тексту, а не по вакансии', () => {
  it('русский текст с латинскими терминами — русский', () => {
    expect(letterTextLanguage('Здравствуйте! Откликаюсь на вакансию Head of Platform в CloudScale. Kubernetes и AWS.')).toBe('ru');
  });

  it('английский текст с русским названием компании — английский', () => {
    expect(letterTextLanguage('Dear hiring team, I am applying for the CTO role at Рога и копыта. I led a team of 250.')).toBe('en');
  });
});

describe('splitSignatureLine (B624): имя для подписи отдельной последней строкой', () => {
  it('снимает строку с именем и отдаёт письмо без неё', () => {
    expect(splitSignatureLine('Здравствуйте.\n\nБуду рад обсудить.\n\nИмя для подписи: Алексей Денисов')).toEqual({
      body: 'Здравствуйте.\n\nБуду рад обсудить.',
      name: 'Алексей Денисов',
    });
  });

  it('понимает английскую подпись строки и разметку модели', () => {
    expect(splitSignatureLine('Dear team.\n\nI look forward to it.\n**Name for signature:** Alexey Denisov')).toEqual({
      body: 'Dear team.\n\nI look forward to it.',
      name: 'Alexey Denisov',
    });
  });

  it('без строки письмо остаётся как было, имени нет', () => {
    expect(splitSignatureLine('Здравствуйте.\n\nБуду рад обсудить.')).toEqual({ body: 'Здравствуйте.\n\nБуду рад обсудить.' });
  });
});

describe('letterSignatureName (B624): имя модели берётся только в письменности письма', () => {
  it('русское письмо — кириллица, английское — латиница', () => {
    expect(letterSignatureName('Алексей Денисов', 'ru')).toBe('Алексей Денисов');
    expect(letterSignatureName('Alexey Denisov', 'en')).toBe('Alexey Denisov');
    expect(letterSignatureName("Anna-Maria O'Neil", 'en')).toBe("Anna-Maria O'Neil");
  });

  it('имя не на языке письма, фраза или пустое — не имя', () => {
    expect(letterSignatureName('Alexey Denisov', 'ru')).toBeUndefined();
    expect(letterSignatureName('Алексей Денисов', 'en')).toBeUndefined();
    expect(letterSignatureName('Алексей Денисов, руководитель направления данных', 'ru')).toBeUndefined();
    expect(letterSignatureName('[Имя Фамилия]', 'ru')).toBeUndefined();
    expect(letterSignatureName('  ', 'ru')).toBeUndefined();
    expect(letterSignatureName(undefined, 'ru')).toBeUndefined();
  });
});
