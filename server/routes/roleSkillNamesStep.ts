import type { FastifyReply } from 'fastify';
import { canonicalizeSkill } from '../connectors/managementSkillsDictionary';
import type { RoleSkillAssessmentRun } from '../domain/roleSkillAssessment';
import { runSkillNames, withSkillNames } from '../domain/roleSkillNames';
import type { RouteDeps } from './deps';

const CYRILLIC = /[а-яё]/iu;

/**
 * Русское каноническое имя из словаря навыков: «Executive Leadership» → «Управление
 * командой». Уже русские названия и названия без русского имени в словаре сюда не входят.
 */
export function russianNamesFromDictionary(names: readonly string[]): ReadonlyMap<string, string> {
  return new Map(
    names.flatMap((name) => {
      const canonical = canonicalizeSkill(name);
      return !CYRILLIC.test(name) && canonical !== name && CYRILLIC.test(canonical) ? [[name, canonical] as const] : [];
    }),
  );
}

/** Модель спрашивают о названиях без русского имени; сбой — они остаются как в вакансиях. */
async function translatedByModel(
  deps: RouteDeps,
  reply: FastifyReply,
  names: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (!deps.skillNameTranslator || names.length === 0) return new Map();
  try {
    return await deps.skillNameTranslator.translate(names);
  } catch (error) {
    reply.log.warn({ failureType: error instanceof Error ? error.name : 'unknown' }, 'role-skill-names-untranslated');
    return new Map();
  }
}

/** B734: сначала словарь навыков, затем один вызов модели на старте; проверка не ждёт сбоя. */
export async function withRussianSkillNames(
  deps: RouteDeps,
  reply: FastifyReply,
  run: RoleSkillAssessmentRun,
): Promise<RoleSkillAssessmentRun> {
  const names = runSkillNames(run);
  const dictionary = russianNamesFromDictionary(names);
  const rest = names.filter((name) => !dictionary.has(name) && !CYRILLIC.test(name));
  const model = await translatedByModel(deps, reply, rest);
  return withSkillNames(run, new Map([...model, ...dictionary]));
}

/**
 * B747: проверки до B734 хранят английские названия («Cross-functional leadership»),
 * и «Карьера» показывала их рядом с русскими требованиями. Чтение переводит словарём
 * без вызова модели и сливает повторы («Team leadership» — тоже «Управление командой»).
 */
export function russianSkillNames(names: readonly string[]): string[] {
  const dictionary = russianNamesFromDictionary(names);
  return [...new Set(names.map((name) => dictionary.get(name) ?? name))];
}
