import { describe, expect, it } from 'vitest';
import { resolveRoleNameLanguage } from './roleNameLanguage';

const cyrillicResume = 'Кандидат руководил технологическими подразделениями и облачной инфраструктурой.';
const latinResume = 'Candidate led technology divisions and cloud infrastructure.';

describe('язык названия роли', () => {
  it('рынок поиска бьёт всё остальное: нерусскоязычный рынок — английский', () => {
    expect(
      resolveRoleNameLanguage({
        searchRegions: ['ru', 'mena'],
        targetRoles: ['Кладовщик'],
        resumeText: cyrillicResume,
      }),
    ).toEqual({ language: 'en', reason: 'markets' });
  });

  it('только русскоязычные рынки — русское название', () => {
    expect(
      resolveRoleNameLanguage({
        searchRegions: ['ru', 'cis'],
        targetRoles: ['CTO'],
        resumeText: latinResume,
      }),
    ).toEqual({ language: 'ru', reason: 'markets' });
  });

  it('уровень роли решает только когда рынки не названы', () => {
    expect(
      resolveRoleNameLanguage({ searchRegions: [], targetRoles: ['VP of Technology'], resumeText: cyrillicResume }),
    ).toEqual({ language: 'en', reason: 'level' });
  });

  it('без рынков и без уровня решает язык резюме', () => {
    expect(
      resolveRoleNameLanguage({ searchRegions: [], targetRoles: ['Кладовщик'], resumeText: cyrillicResume }),
    ).toEqual({ language: 'ru', reason: 'resume-language' });
  });

  it('когда не известно ничего — английский, потому что эта ошибка дешевле', () => {
    // Русское имя на англоязычном рынке делает кандидата невидимым; английское
    // на русском — лишь трение (записка стратега, 2026-09-03).
    expect(resolveRoleNameLanguage({})).toEqual({ language: 'en', reason: 'default' });
  });

  it('русскоязычный директор производства не становится английским из-за слова «директор»', () => {
    // Уровень — слабый признак, и он ниже рынка поиска: правило владельца
    // «C-level → английский» ломается ровно здесь (записка стратега).
    expect(
      resolveRoleNameLanguage({
        searchRegions: ['ru'],
        targetRoles: ['Директор по производству'],
        resumeText: cyrillicResume,
      }),
    ).toEqual({ language: 'ru', reason: 'markets' });
  });
});
