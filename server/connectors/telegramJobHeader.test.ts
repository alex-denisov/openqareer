import { describe, expect, it } from 'vitest';
import { extractTelegramJobHeader } from './telegramJobHeader';

/**
 * Every case here is the shape of a real post read from the five channels the
 * registry syncs (2026-08-30). Before this module 86 of 96 vacancies carried
 * the invented employer `IT Company`, and the title the candidate read was the
 * post's hashtag line (B164).
 */
describe('extractTelegramJobHeader', () => {
  it('reads the employer named on the line above the title, not the hashtags', () => {
    const header = extractTelegramJobHeader([
      '#middle #офис #москва',
      'МТС Банк',
      'Frontend-разработчик',
      'Формат работы: Москва (офис)',
    ]);
    expect(header.title).toBe('Frontend-разработчик');
    expect(header.company).toBe('МТС Банк');
  });

  it('keeps a quoted employer whole', () => {
    const header = extractTelegramJobHeader([
      '#intern #москва',
      'ИТ-компания «Лоция»',
      'Стажёр-фронтенд разработчик',
    ]);
    expect(header.title).toBe('Стажёр-фронтенд разработчик');
    expect(header.company).toBe('ИТ-компания «Лоция»');
  });

  it('splits an employer named inside the title after "в"', () => {
    const header = extractTelegramJobHeader([
      '#вакансия #ML #Engineer',
      'ML Engineer в «Максима Прайдекс»',
      'Мы создаем системы управления очередью для крупных клиентов.',
    ]);
    expect(header.title).toBe('ML Engineer');
    expect(header.company).toBe('Максима Прайдекс');
  });

  it('drops the sentence tail a channel appends after the employer', () => {
    const header = extractTelegramJobHeader(['SMM-маркетолог в Badaboom. Удаленка.', 'О НАС:']);
    expect(header.title).toBe('SMM-маркетолог');
    expect(header.company).toBe('Badaboom');
  });

  it('says nothing about the employer when the post never names one', () => {
    const header = extractTelegramJobHeader([
      'Level Artist / Unity',
      'Ищем Level Artist для участия в разработке кооперативной игры на Unity.',
    ]);
    expect(header.title).toBe('Level Artist / Unity');
    expect(header.company).toBe('');
  });

  it('never turns a common noun after "в" into an employer', () => {
    const header = extractTelegramJobHeader(['Разработчик в команду мечты', 'Задачи:']);
    expect(header.title).toBe('Разработчик в команду мечты');
    expect(header.company).toBe('');
  });

  it('still prefers an explicitly labelled employer', () => {
    const header = extractTelegramJobHeader([
      'Фронтенд-разработчик',
      '#удаленка',
      'Компания: Комета',
      'Вилка 200 000 – 240 000 ₽',
    ]);
    expect(header.title).toBe('Фронтенд-разработчик');
    expect(header.company).toBe('Комета');
  });

  it('falls back to a role name when the post opens with hashtags only', () => {
    const header = extractTelegramJobHeader(['#вакансия #middle #удаленка', 'Ищем Data Engineer', 'Формат: удаленно']);
    expect(header.title).toBe('Data Engineer');
    expect(header.company).toBe('');
  });

  it('falls back to a role name when the post carries no readable lines at all', () => {
    const header = extractTelegramJobHeader(['#вакансия', '   ']);
    expect(header.title).toBe('Разработчик');
    expect(header.company).toBe('');
  });

  it('reads a straight-quoted employer too', () => {
    const header = extractTelegramJobHeader(['Data Analyst в "Ромашка"', 'Задачи:']);
    expect(header.title).toBe('Data Analyst');
    expect(header.company).toBe('Ромашка');
  });

  it('keeps the title whole when the words after "в" are not a role at all', () => {
    const header = extractTelegramJobHeader(['Работа в удовольствие', 'О НАС:']);
    expect(header.company).toBe('');
  });

  it('refuses an employer longer than a name can be', () => {
    const tail = 'Очень Длинное Название Которое Никак Не Может Быть Именем Работодателя Компании';
    const header = extractTelegramJobHeader([`Аналитик в ${tail}`, 'Задачи:']);
    expect(header.company).toBe('');
    expect(header.title).toBe(`Аналитик в ${tail}`);
  });

  it('does not read a heading line as the employer', () => {
    const header = extractTelegramJobHeader(['О НАС:', 'Ищем разработчика', 'Задачи:']);
    expect(header.company).toBe('');
    expect(header.title).toBe('О НАС:');
  });

  it('never turns a city into an employer', () => {
    const header = extractTelegramJobHeader(['Frontend разработчик в Москве', 'Задачи:']);
    expect(header.company).toBe('');
    expect(header.title).toBe('Frontend разработчик в Москве');
  });

  it('never turns a greeting above the role into an employer', () => {
    const header = extractTelegramJobHeader(['Всем привет!', 'Ищем Python разработчика', 'Задачи:']);
    expect(header.company).toBe('');
  });

  it('does not read an employer out of a sentence that is not a job title', () => {
    const header = extractTelegramJobHeader([
      'Доступ к реальным датасетам остается барьером для специалистов уровня junior в Data Science',
      'Корпоративные чемпионаты частично закрывают этот пробел.',
    ]);
    expect(header.company).toBe('');
  });
});
