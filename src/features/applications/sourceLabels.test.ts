import { describe, expect, it } from 'vitest';
import { humanSourceLabel } from './sourceLabels';

describe('humanSourceLabel (B412)', () => {
  it('Критерий 1: Известные id отображаются человеческими названиями', () => {
    expect(humanSourceLabel('src-hh-search')).toBe('hh.ru (поиск)');
    expect(humanSourceLabel('hh-search')).toBe('hh.ru (поиск)');
    expect(humanSourceLabel('hh')).toBe('hh.ru');
    expect(humanSourceLabel('src-hh')).toBe('hh.ru');
    expect(humanSourceLabel('linkedin')).toBe('LinkedIn');
    expect(humanSourceLabel('src-linkedin')).toBe('LinkedIn');
    expect(humanSourceLabel('src-linkedin-guest')).toBe('LinkedIn');
    expect(humanSourceLabel('src-linkedin-crawler')).toBe('LinkedIn');
    expect(humanSourceLabel('indeed')).toBe('Indeed');
    expect(humanSourceLabel('src-indeed')).toBe('Indeed');
    expect(humanSourceLabel('telegram')).toBe('Telegram-канал');
    expect(humanSourceLabel('src-telegram')).toBe('Telegram-канал');
    expect(humanSourceLabel('src-tg-product')).toBe('Telegram-канал');
    expect(humanSourceLabel('manual')).toBe('Ввод вручную');
    expect(humanSourceLabel('recruiter')).toBe('Ввод вручную');
  });

  it('Критерий 2: ats-<система>-<компания> раскладывается в «ATS: Система · Компания»', () => {
    expect(humanSourceLabel('ats-ashby-snowflake')).toBe('ATS: Ashby · Snowflake');
    expect(humanSourceLabel('ats-lever-figma')).toBe('ATS: Lever · Figma');
    expect(humanSourceLabel('ats-greenhouse-stripe')).toBe('ATS: Greenhouse · Stripe');
  });

  it('Критерий 3: Неизвестный id не показывает префиксов src-/ats- (3 неизвестных id)', () => {
    const unknown1 = humanSourceLabel('src-custom-board');
    const unknown2 = humanSourceLabel('ats-isolated-portal');
    const unknown3 = humanSourceLabel('src-global-remote-jobs');

    expect(unknown1).toBe('Custom board');
    expect(unknown1).not.toMatch(/^src-/i);
    expect(unknown1).not.toMatch(/^ats-/i);

    expect(unknown2).toBe('ATS: Isolated · Portal');
    expect(unknown2).not.toMatch(/^src-/i);
    expect(unknown2).not.toMatch(/^ats-/i);

    expect(unknown3).toBe('Global remote jobs');
    expect(unknown3).not.toMatch(/^src-/i);
    expect(unknown3).not.toMatch(/^ats-/i);

    // Дополнительный одиночный неизвестный без дефисов
    const unknown4 = humanSourceLabel('src-geekjob');
    expect(unknown4).toBe('Geekjob');
    expect(unknown4).not.toMatch(/src-/i);
  });
});
