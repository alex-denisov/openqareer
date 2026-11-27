import { describe, expect, it } from 'vitest';
import { onPlatform, platformOf, sendFrom, viaPlatform } from './platform';

describe('название площадки для кандидата', () => {
  it('знакомые площадки названы по-человечески', () => {
    expect(platformOf('hh').label).toBe('hh.ru');
    expect(platformOf('linkedin').label).toBe('LinkedIn');
    expect(platformOf('LinkedIn (пул аккаунтов)').label).toBe('LinkedIn');
  });

  it('внутренний код источника не показывается', () => {
    for (const code of ['ats-ashby-snowflake', 'ATS-Ashby-Snowflake', 'ats.lever.acme', 'json_api', 'manual', 'rss', '', null]) {
      expect(platformOf(code)).toEqual({ label: 'сайт компании', site: true });
    }
  });

  it('площадка без своей строки в списке остаётся названием, а не «сайтом компании»', () => {
    expect(platformOf('Habr Career')).toEqual({ label: 'Habr Career', site: false });
    expect(platformOf('indeed')).toEqual({ label: 'Indeed', site: false });
    expect(platformOf('superjob')).toEqual({ label: 'Superjob', site: false });
    expect(platformOf('my-linkedin-clone').label).toBe('My-linkedin-clone');
  });

  it('коды freehire: площадка — одним именем, карьерный сайт — сайт компании (Д10)', () => {
    expect(platformOf('src-fh-getmatch')).toEqual(platformOf('getmatch'));
    expect(platformOf('fh-getmatch').label).toBe('Getmatch');
    expect(platformOf('src-fh-habr-career').label).toBe('Хабр Карьера');
    expect(platformOf('src-fh-rwb')).toEqual({ label: 'сайт компании', site: true });
  });

  it('предлоги согласованы', () => {
    const site = platformOf('ats-ashby-snowflake');
    expect(viaPlatform(site)).toBe('через сайт компании');
    expect(onPlatform(site)).toBe('на сайте компании');
    expect(sendFrom(site)).toBe('на сайте компании');
    expect(onPlatform(platformOf('hh'))).toBe('на hh.ru');
    expect(sendFrom(platformOf('hh'))).toBe('с hh.ru');
  });

  it('коды сбора «src-…» называются по-человечески (B645)', () => {
    expect(platformOf('src-hh-search').label).toBe('hh.ru');
    expect(platformOf('src-indeed').label).toBe('Indeed');
    expect(platformOf('src-himalayas-api').label).toBe('Himalayas');
    expect(platformOf('src-linkedin-jobs').label).toBe('LinkedIn');
    expect(platformOf('src-remotive').label).toBe('Remotive');
    expect(platformOf('src-ats-greenhouse')).toEqual({ label: 'сайт компании', site: true });
  });
});
