import { createHash } from 'node:crypto';
import { ontology } from '../../shared/roleOntology';
import { buildVacancySlug } from '../../shared/vacancyCatalogRoutes';
import type { SalaryMarketGrade, SalaryMarketProfession } from '../../shared/salaryMarketSnapshot';
import { rulesParse } from '../vacancies/titleParse/rulesParse';
import { normalizeTitleKey } from '../vacancies/titleParse/normalizeTitleKey';

interface AliasIndex {
  exact: Map<string, Set<string>>;
  phrases: Map<string, Set<string>>;
}
function addAlias(index: Map<string, Set<string>>, alias: string, id: string): void {
  const roles = index.get(alias) ?? new Set<string>();
  roles.add(id);
  index.set(alias, roles);
}
function aliasIndex(): AliasIndex {
  const exact = new Map<string, Set<string>>();
  const phrases = new Map<string, Set<string>>();
  for (const role of ontology.roles)
    for (const variant of [...role.variants.en, ...role.variants.ru]) {
      const normalized = normalizeTitleKey(variant);
      addAlias(exact, normalized, role.id);
      const words = normalized.match(/\p{L}+/gu) ?? [];
      if (words.length >= 2) addAlias(phrases, words.join(' '), role.id);
    }
  return { exact, phrases };
}
const ALIASES = aliasIndex();
const SLUG_COUNTS = new Map<string, number>();
for (const role of ontology.roles) {
  const slug = buildVacancySlug(role.titleEn) ?? '';
  SLUG_COUNTS.set(slug, (SLUG_COUNTS.get(slug) ?? 0) + 1);
}

/** rulesParse chooses the first dictionary collision; publication additionally requires uniqueness. */
function unambiguousAlias(title: string, roleId: string): string | undefined {
  const normalized = normalizeTitleKey(title);
  const exact = ALIASES.exact.get(normalized);
  if (exact) {
    const role = ontology.rolesById.get(roleId);
    const singleWord = (normalized.match(/\p{L}+/gu) ?? []).length < 2;
    const canonicalName =
      role && [role.titleEn, role.titleRu].some((name) => normalizeTitleKey(name) === normalized);
    return exact.size === 1 && exact.has(roleId) && (!singleWord || canonicalName)
      ? normalized
      : undefined;
  }
  const words = normalized.match(/\p{L}+/gu) ?? [];
  for (let length = words.length; length >= 2; length -= 1) {
    const matches = new Map<string, Set<string>>();
    for (let start = 0; start <= words.length - length; start += 1) {
      const phrase = words.slice(start, start + length).join(' ');
      const ids = ALIASES.phrases.get(phrase);
      if (ids) matches.set(phrase, ids);
    }
    if (matches.size === 0) continue;
    const ids = new Set([...matches.values()].flatMap((value) => [...value]));
    return ids.size === 1 && ids.has(roleId) ? matches.keys().next().value : undefined;
  }
  return undefined;
}

const MANAGEMENT =
  /(?<![\p{L}\p{N}])(?:director|head|chief|president|vp|директор|руководитель|начальник)(?![\p{L}\p{N}])/iu;
const NON_GRADE_CONTEXT =
  /lead\s+(?:generation|gen)|middle\s+(?:east|school)|junior\s+high|senior\s+(?:living|housing|care)/giu;
const GRADE_MARKERS: readonly [Exclude<SalaryMarketGrade, 'unknown'>, RegExp][] = [
  ['junior', /(?<![\p{L}\p{N}])(?:junior|jr\.?|джуниор|джун|младший|младшая)(?![\p{L}\p{N}])/iu],
  ['middle', /(?<![\p{L}\p{N}])(?:middle|mid-level|мидл|миддл)(?![\p{L}\p{N}])/iu],
  ['senior', /(?<![\p{L}\p{N}])(?:senior|sr\.?|сеньор|сениор|старший|старшая)(?![\p{L}\p{N}])/iu],
  ['lead', /(?<![\p{L}\p{N}])(?:lead|лид|тимлид|тим-лид)(?![\p{L}\p{N}])/iu],
];
export interface PostedSalaryGrade {
  readonly grade: SalaryMarketGrade;
  readonly marker: string | null;
}
/** Published title marker only, not an assessment of an individual's actual seniority. */
export function postedSalaryGrade(title: string): PostedSalaryGrade {
  if (MANAGEMENT.test(title)) return { grade: 'unknown', marker: null };
  const contextual = title.replace(NON_GRADE_CONTEXT, ' ');
  const hits = GRADE_MARKERS.flatMap(([grade, pattern]) => {
    const match = pattern.exec(contextual);
    return match ? [{ grade, marker: match[0] }] : [];
  });
  return hits.length === 1 ? hits[0]! : { grade: 'unknown', marker: null };
}

export interface SalaryTitleClassification {
  readonly role: string;
  readonly roleLabel: string;
  readonly profession: SalaryMarketProfession;
  readonly grade: PostedSalaryGrade;
}
export function classifySalaryMarketTitle(
  title: string,
  sourceSlug: string | null,
): SalaryTitleClassification {
  const grade = postedSalaryGrade(title);
  let aliasTitle = title;
  let parsed = title.length <= 500 ? rulesParse(title) : undefined;
  if (!parsed?.roleId && grade.marker && grade.grade !== 'lead' && title.length <= 500) {
    aliasTitle = title.replace(grade.marker, ' ').trim();
    parsed = rulesParse(aliasTitle);
  }
  const role = parsed?.roleId ? ontology.rolesById.get(parsed.roleId) : undefined;
  const alias =
    role && parsed?.functions.length === 1 ? unambiguousAlias(aliasTitle, role.id) : undefined;
  if (role && alias) {
    const simple = buildVacancySlug(role.titleEn) ?? role.id.replace(/\./gu, '-');
    const slug = (SLUG_COUNTS.get(simple) ?? 0) > 1 ? `${role.function}-${simple}` : simple;
    return {
      role: slug,
      roleLabel: role.titleRu || role.titleEn,
      profession: { kind: 'b267', roleId: role.id, matchedAlias: alias },
      grade,
    };
  }
  const hash = createHash('sha256')
    .update(title.trim().toLowerCase().replace(/\s+/gu, ' '))
    .digest('hex')
    .slice(0, 16);
  const safe =
    sourceSlug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(sourceSlug)
      ? sourceSlug.slice(0, 45).replace(/-$/u, '')
      : 'title';
  return {
    role: `unclassified-${safe}-${hash}`,
    roleLabel: title,
    profession: { kind: 'unclassified_title' },
    grade,
  };
}
