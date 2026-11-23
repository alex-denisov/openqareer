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

/** B747: перевод модели живёт в процессе — `/current` читают на каждом экране, модель — раз на название. */
const MODEL_NAMES_MAX = 5_000;
const modelNames = new Map<string, string>();

function remember(translated: ReadonlyMap<string, string>): void {
  for (const [name, russian] of translated) {
    if (modelNames.size >= MODEL_NAMES_MAX) modelNames.delete(modelNames.keys().next().value as string);
    modelNames.set(name, russian);
  }
}

/** B734: сначала словарь навыков, затем модель — только о том, чего нет ни в словаре, ни в памяти. */
export async function russianNameMap(
  deps: RouteDeps,
  reply: FastifyReply,
  names: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const dictionary = russianNamesFromDictionary(names);
  const rest = names.filter((name) => !dictionary.has(name) && !CYRILLIC.test(name) && !modelNames.has(name));
  remember(await translatedByModel(deps, reply, rest));
  const known = names.flatMap((name) => {
    const russian = modelNames.get(name);
    return russian ? [[name, russian] as const] : [];
  });
  return new Map([...known, ...dictionary]);
}

/** B734: сначала словарь навыков, затем один вызов модели на старте; проверка не ждёт сбоя. */
export async function withRussianSkillNames(
  deps: RouteDeps,
  reply: FastifyReply,
  run: RoleSkillAssessmentRun,
): Promise<RoleSkillAssessmentRun> {
  return withSkillNames(run, await russianNameMap(deps, reply, runSkillNames(run)));
}

interface NamedContext {
  readonly skills: readonly { readonly name: string }[];
  readonly cases: readonly { readonly skillName: string; readonly prompt: string }[];
}

/** B747: требования роли до старта проверки — те же русские названия, что получит проверка. */
export async function withRussianContextNames<T extends NamedContext>(
  deps: RouteDeps,
  reply: FastifyReply,
  context: T,
): Promise<T> {
  const names = [...new Set([...context.skills.map((skill) => skill.name), ...context.cases.map((item) => item.skillName)])];
  const map = await russianNameMap(deps, reply, names);
  const rename = (name: string) => map.get(name) ?? name;
  return {
    ...context,
    skills: context.skills.map((skill) => ({ ...skill, name: rename(skill.name) })),
    cases: context.cases.map((item) => ({
      ...item,
      skillName: rename(item.skillName),
      prompt: item.prompt.split(`«${item.skillName}»`).join(`«${rename(item.skillName)}»`),
    })),
  };
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
