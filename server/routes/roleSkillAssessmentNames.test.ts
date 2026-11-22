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
    expect(run.skills.every((skill) => skill.name.startsWith('Рус: '))).toBe(true);
    for (const record of run.cases) {
      expect(record.assessmentCase.skillName.startsWith('Рус: ')).toBe(true);
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
