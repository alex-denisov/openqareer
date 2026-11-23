import { describe, expect, it } from 'vitest';
import { rolePlatformCode } from './rolePlatformCode';

describe('rolePlatformCode (B767): площадка в подписи вилки роли, а не тип транспорта', () => {
  it('json_api называет площадку: hh, LinkedIn, сайты компаний, агрегатор по имени', () => {
    const code = (sourceId: string, sourceName?: string) =>
      rolePlatformCode({ sourceType: 'json_api', sourceId, sourceName });
    expect(code('src-hh-search', 'hh.ru (страница поиска)')).toBe('hh');
    expect(code('src-linkedin-guest', 'LinkedIn')).toBe('linkedin');
    expect(code('ats-workday-caresource', 'CareSource')).toBe('career_site');
    expect(code('src-company-site-sporty-group', 'Sporty Group Careers')).toBe('career_site');
    expect(code('src-fh-icims-devereux', 'Devereux (iCIMS)')).toBe('career_site');
    expect(code('src-indeed', 'Indeed')).toBe('Indeed');
    expect(code('src-unknown')).toBe('json_api');
  });

  it('источник со своим типом остаётся при нём', () => {
    expect(rolePlatformCode({ sourceType: 'telegram', sourceId: 'tg-x' })).toBe('telegram');
    expect(rolePlatformCode({ sourceType: 'hh', sourceId: 'hh' })).toBe('hh');
  });
});
