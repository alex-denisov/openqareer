import { describe, expect, it } from 'vitest';
import { onPlatform, platformOf, sendFrom, viaPlatform } from './platform';

describe('название площадки для кандидата', () => {
  it('знакомые площадки названы по-человечески', () => {
    expect(platformOf('hh').label).toBe('hh.ru');
    expect(platformOf('linkedin').label).toBe('LinkedIn');
    expect(platformOf('LinkedIn (пул аккаунтов)').label).toBe('LinkedIn');
  });

  it('внутренний код источника не показывается', () => {
    for (const code of ['ats-ashby-snowflake', 'json_api', 'manual', 'rss', 'greenhouse-acme', '', null]) {
      expect(platformOf(code)).toEqual({ label: 'сайт компании', site: true });
    }
  });

  it('название с заглавной остаётся названием', () => {
    expect(platformOf('Habr Career')).toEqual({ label: 'Habr Career', site: false });
  });

  it('предлоги согласованы', () => {
    const site = platformOf('ats-ashby-snowflake');
    expect(viaPlatform(site)).toBe('через сайт компании');
    expect(onPlatform(site)).toBe('на сайте компании');
    expect(sendFrom(site)).toBe('на сайте компании');
    expect(onPlatform(platformOf('hh'))).toBe('на hh.ru');
    expect(sendFrom(platformOf('hh'))).toBe('с hh.ru');
  });
});
