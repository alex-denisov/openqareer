import { describe, expect, it, vi } from 'vitest';
import type { SkillNameTranslator } from '../providers/skillNameTranslator';
import { createRig, startRun } from './roleSkillAssessmentRouteTestRig';

const russian = (name: string) => `Рус: ${name}`;

describe('названия навыков проверки по-русски (B734)', () => {
  it('один вызов на старте: навыки, кейсы и текст вопроса — с русским названием', async () => {
    const translate = vi.fn(async (names: readonly string[]) => new Map(names.map((name) => [name, russian(name)])));
    const rig = await createRig(8, false, { extraDeps: { skillNameTranslator: { translate } satisfies SkillNameTranslator } });
    const run = await startRun(rig);
    expect(translate).toHaveBeenCalledTimes(1);
    const cyrillic = /[а-яё]/iu;
    expect(run.skills.every((skill) => cyrillic.test(skill.name))).toBe(true);
    for (const record of run.cases) {
      expect(cyrillic.test(record.assessmentCase.skillName)).toBe(true);
      expect(record.assessmentCase.prompt).toContain(`«${record.assessmentCase.skillName}»`);
    }
    const again = await startRun(rig);
    expect(again.id).toBe(run.id);
    expect(translate).toHaveBeenCalledTimes(1);
  });

  it('сбой перевода не мешает проверке: названия как в вакансиях', async () => {
    const translate = vi.fn(async () => {
      throw new Error('model down');
    });
    const plain = await startRun(await createRig(8));
    const rig = await createRig(8, false, { extraDeps: { skillNameTranslator: { translate } } });
    const run = await startRun(rig);
    expect(run.skills.map((skill) => skill.name)).toEqual(plain.skills.map((skill) => skill.name));
    expect(run.cases.map((record) => record.assessmentCase.skillName)).toEqual(
      plain.cases.map((record) => record.assessmentCase.skillName),
    );
  });

  it('название без перевода в ответе остаётся прежним', async () => {
    const translate = vi.fn(async () => new Map<string, string>());
    const plain = await startRun(await createRig(8));
    const run = await startRun(await createRig(8, false, { extraDeps: { skillNameTranslator: { translate } } }));
    expect(run.skills.map((skill) => skill.name)).toEqual(plain.skills.map((skill) => skill.name));
  });
});

describe('словарь навыков раньше модели (B734)', () => {
  it('русское каноническое имя из словаря берётся без вызова модели', async () => {
    const { russianNamesFromDictionary } = await import('./roleSkillNamesStep');
    expect(russianNamesFromDictionary(['Executive Leadership', 'Team management', 'Kafka', 'Управление сроками'])).toEqual(
      new Map([
        ['Executive Leadership', 'Управление командой'],
        ['Team management', 'Управление командой'],
      ]),
    );
  });

  it('модель спрашивают только о названиях без русского имени', async () => {
    const translate = vi.fn(async (names: readonly string[]) => new Map(names.map((name) => [name, russian(name)])));
    const { withRussianSkillNames } = await import('./roleSkillNamesStep');
    const run = await startRun(await createRig(8));
    const sent = await withRussianSkillNames(
      { skillNameTranslator: { translate } } as never,
      { log: { warn: () => undefined } } as never,
      run,
    );
    const asked = (translate.mock.calls[0]?.[0] ?? []) as readonly string[];
    expect(asked.every((name) => !/[а-яё]/iu.test(name))).toBe(true);
    expect(sent.skills.length).toBe(run.skills.length);
  });
});
