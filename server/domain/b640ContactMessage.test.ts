import { describe, expect, it } from 'vitest';
import { acceptModelMessage, contactMessageWish, modelMessageRejection, shorteningCorrection, type ContactMessageFacts } from './b640ContactMessage';
import { B640_CONTACT_MESSAGE_DRAFT_MAX } from '../../shared/b640ContactMessage';

describe('B753: почему текст модели не принят', () => {
  const known = 'Пётр, директор по данным, 12 лет';

  it('пустой, длинный, с новыми цифрами — своя причина; годный — без причины', () => {
    expect(modelMessageRejection(undefined, known)).toBe('empty');
    expect(modelMessageRejection('   ', known)).toBe('empty');
    expect(modelMessageRejection('а'.repeat(B640_CONTACT_MESSAGE_DRAFT_MAX + 1), known)).toBe('too_long');
    expect(modelMessageRejection('Привет! У меня 15 лет опыта.', known)).toBe('new_digits');
    expect(modelMessageRejection('Привет! У меня 12 лет опыта.', known)).toBeNull();
  });

  it('acceptModelMessage принимает ровно то, у чего нет причины', () => {
    expect(acceptModelMessage('Привет! У меня 12 лет опыта.', known)).toBe('Привет! У меня 12 лет опыта.');
    expect(acceptModelMessage('Привет! У меня 15 лет опыта.', known)).toBeNull();
  });
});

describe('B753: сообщение знакомому — не отклик работодателю', () => {
  const known = 'Пётр, директор по данным, 12 лет';
  const formulas = [
    'Анна, привет! Откликаюсь на вакансию VK — директор по данным.',
    'Анна, добрый день. Прошу рассмотреть меня на роль в VK.',
    'Анна, рассмотрите, пожалуйста, мою кандидатуру в VK.',
    'Анна, привет! Направляю своё резюме на вакансию VK.',
  ];

  it.each(formulas)('знакомому слова отклика не принимаются: %s', (text) => {
    expect(modelMessageRejection(text, known, 'known_contact')).toBe('response_formula');
    expect(modelMessageRejection(text, known, 'ask_introduction')).toBe('response_formula');
    expect(acceptModelMessage(text, known, 'known_contact')).toBeNull();
  });

  it('рекрутёру те же слова допустимы', () => {
    for (const text of formulas) expect(modelMessageRejection(text, known, 'recruiter')).toBeNull();
  });

  const facts = (kind: ContactMessageFacts['kind']): ContactMessageFacts => ({
    kind,
    recipientName: 'Анна Смирнова',
    recipientCompany: 'VK',
    targetRole: 'Директор по данным',
    vacancyTitle: 'Директор по данным',
    vacancyCompany: 'VK',
  });

  it('просьба к модели для знакомого: не отклик, по имени, просьба, один факт', () => {
    const wish = contactMessageWish(facts('known_contact'));
    for (const part of ['не отклик работодателю', '«Откликаюсь»', 'по имени', 'порекомендовать', 'рассказать о команде', 'один факт из профиля']) {
      expect(wish).toContain(part);
    }
  });

  it('у рекрутёра свой тон: правил знакомому нет', () => {
    const wish = contactMessageWish(facts('recruiter'));
    expect(wish).not.toContain('не отклик работодателю');
    expect(wish).toContain('рекрутёру');
  });
});

describe('B753: длина сообщения в просьбе к модели', () => {
  it('просит 3–4 коротких предложения и не длиннее 400 знаков', () => {
    const wish = contactMessageWish({ kind: 'recruiter', recipientName: 'Ольга', recipientCompany: 'СБЕР', targetRole: '' });
    expect(wish).toContain('3–4 коротких предложения');
    expect(wish).toContain('Не длиннее 400 знаков');
  });
});

describe('B753: русский язык, имя и сокращение', () => {
  const known = 'Пётр, директор по данным, 12 лет';
  it('искажённое слово, как в проверке письма, не принимается', () => {
    expect(modelMessageRejection('Анна, привет! Я руководител отдела данных.', known, 'known_contact')).toBe('distorted');
  });

  it('имя получателя — как в карточке, без перевода и транслитерации', () => {
    const wish = contactMessageWish({ kind: 'known_contact', recipientName: 'Pavel Khudyakov', recipientCompany: 'Lamoda', targetRole: '' });
    expect(wish).toContain('«Pavel»');
    expect(wish).toContain('не переводи');
  });

  it('просьба сократить: свой текст, 400 знаков, просьба и факт, без обрыва', () => {
    const text = shorteningCorrection('Анна, привет! Длинный текст.');
    for (const part of ['Сократи', '400', 'просьбу', 'один факт', 'Анна, привет! Длинный текст.']) expect(text).toContain(part);
  });
});
