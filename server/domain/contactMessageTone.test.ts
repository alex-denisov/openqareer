import { describe, expect, it } from 'vitest';
import { modelMessageRejection } from './b640ContactMessage';
import { toneRejection } from './contactMessageTone';

// B753 (решение CPO 23.11): черновик VK выдумал близость — «Александрыч», «мы же на ты, помнишь?».
const card = { recipientName: 'Alexandr Alexandrov', known: 'Alexandr Alexandrov, VK, VK Tech, P&L, Positive Technologies', language: 'ru' as const };

describe('B753: тон черновика знакомому', () => {
  it('«ты» без признака в карточке — informal_address; с «на ты» в карточке — можно', () => {
    expect(toneRejection('Александр, здравствуйте! Подскажете, кто нанимает?', card)).toBeNull();
    expect(toneRejection('Александр, здравствуйте! Подскажи, у тебя есть контакт?', card)).toBe('informal_address');
    expect(toneRejection('Здравствуй, Александр! Как дела в VK?', card)).toBe('informal_address');
    expect(toneRejection('Александр, привет! Мы с ним на ты.', card)).toBe('informal_address');
    expect(toneRejection('Здравствуйте, Александр! Ваш опыт в VK мне близок.', card)).toBeNull();
    expect(toneRejection('Здравствуй, Александр! У тебя есть минута?', { ...card, relationship: 'Друг, на ты' })).toBeNull();
  });

  it('имя в приветствии — только из карточки или его кириллица', () => {
    expect(toneRejection('Здравствуйте, Александр! Пишу про VK.', card)).toBeNull();
    expect(toneRejection('Alexandr, здравствуйте! Пишу про VK.', card)).toBeNull();
    expect(toneRejection('Здравствуйте, Александрыч! Пишу про VK.', card)).toBe('greeting_name');
    expect(toneRejection('Саша, добрый день! Пишу про VK.', card)).toBe('greeting_name');
    expect(toneRejection('Здравствуйте, Александр Петрович! Пишу про VK.', card)).toBe('greeting_name');
    expect(toneRejection('Hi Ayesha, I am reaching out.', { recipientName: 'Ayesha Khan', known: 'Ayesha Khan', language: 'en' })).toBeNull();
    expect(toneRejection('Здравствуйте, Павел.\n\nПишу по поводу поиска работы.', { ...card, recipientName: 'Pavel Petrov' })).toBeNull();
  });

  it('выдуманная общая история без связи в карточке — invented_history', () => {
    expect(toneRejection('Александр, здравствуйте! Помните, как работали над VK Tech?', card)).toBe('invented_history');
    expect(toneRejection('Александр, здравствуйте! Мы же давно знакомы.', card)).toBe('invented_history');
    expect(toneRejection('Александр, здравствуйте! Помните, как работали над VK Tech?', { ...card, relationship: 'Коллега по VK Tech' })).toBeNull();
  });

  it('латиница в русском черновике — только имена из профиля, карточки и вакансии', () => {
    expect(toneRejection('Александр, здравствуйте! Руководил VK Tech с P&L-ответственностью.', card)).toBeNull();
    expect(toneRejection('Александр, здравствуйте! Руководил командами, с owning P&L.', card)).toBe('latin_word');
    expect(toneRejection('Hi Alexandr, I led teams with P&L ownership.', { ...card, language: 'en' })).toBeNull();
  });

  it('modelMessageRejection берёт причину тона, когда передан получатель', () => {
    const text = 'Здравствуй, Александрыч! Мы же «на ты», помнишь?';
    expect(modelMessageRejection(text, card.known, 'known_contact', [], { recipientName: card.recipientName, language: 'ru' })).toBe('informal_address');
    expect(modelMessageRejection(text, card.known, 'known_contact')).toBeNull();
  });
});
