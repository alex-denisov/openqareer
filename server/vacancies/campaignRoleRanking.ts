import { ontology, type OntologyLevel, type Role } from '../../shared/roleOntology';
import type { FunctionCode } from '../../shared/roleTaxonomy';
import { LEVEL_RANK } from './levelMatcher';
import { rulesParse } from './titleParse/rulesParse';
import type { CampaignRoleFact } from './campaignRoleSet';

/**
 * Rules ranking of auto roles (03.11). Until then the fallback sorted by level and then by
 * alphabet: adenisov.test (VP of Technology, COO) got Chief AI … Chief Growth, and CTO and CIO
 * were cut at ten. Now a role is ranked by the strongest evidence behind it: a position held
 * (or its ontology neighbour) before an achievement, an achievement before a skill. Level is the
 * second key, the amount of evidence the third, alphabet last. A plain sum of weights was tried
 * first: 25 IT-operations facts lifted DevOps Lead over CTO, which the owner's titles support.
 */
const POSITION_TIER = 3;
const WORKPLACE_WEIGHT = 10;
const FACT_WEIGHT: Readonly<Record<string, number>> = {
  outcome: 3,
  responsibility: 2,
  'role-evidence': 2,
  skill: 1,
  other: 1,
};
/** Achievement tier: what was done, owned or said about a role; skill tier: tools and topics. */
const FACT_TIER: Readonly<Record<string, number>> = {
  outcome: 2,
  responsibility: 2,
  'role-evidence': 2,
  skill: 1,
  other: 1,
};

export interface RankedRole {
  readonly role: Role;
  readonly level: OntologyLevel;
  readonly evidenceRefs: readonly string[];
  /** A position held, or its ontology neighbour, stands behind the role. */
  readonly held: boolean;
}

function nearestLevel(role: Role, rank: number): OntologyLevel {
  return role.levels.reduce((best, item) =>
    Math.abs(LEVEL_RANK[item as OntologyLevel] - rank) <
    Math.abs(LEVEL_RANK[best as OntologyLevel] - rank)
      ? item
      : best,
  ) as OntologyLevel;
}

const distance = (role: Role, rank: number) =>
  Math.abs(LEVEL_RANK[nearestLevel(role, rank)] - rank);

const lower = (text: string) => text.toLocaleLowerCase('ru');

/** «Head of IT — Bank (2019 — 2024)» names the place after the dash; the title comes first. */
const titlePart = (text: string) => lower(text.split(/\s[—–-]\s/u)[0] ?? text).trim();

function namesRole(title: string, role: Role): boolean {
  return [...role.variants.en, ...role.variants.ru, role.titleEn, role.titleRu]
    .map(lower)
    .some((variant) => title.includes(variant) || variant.includes(title));
}

/**
 * Roles of the title's functions closest to its level: «VP of Technology» → eng-mgmt.vp. When a
 * role's own name matches the title, only it is taken: «Head of IT» is not also Head of DevOps.
 */
function rolesOfTitle(text: string): Role[] {
  const parsed = rulesParse(text);
  if (parsed.levelRank === null) return [];
  const rank = parsed.levelRank;
  const title = titlePart(text);
  return parsed.functions.flatMap((code) => {
    const roles = ontology.rolesByFunction.get(code) ?? [];
    const best = Math.min(...roles.map((role) => distance(role, rank)));
    const nearest = roles.filter((role) => distance(role, rank) === best);
    const named = nearest.filter((role) => namesRole(title, role));
    return named.length > 0 ? named : nearest;
  });
}

const topRank = (role: Role) =>
  Math.max(...role.levels.map((level) => LEVEL_RANK[level as OntologyLevel]));

/**
 * A position, its ontology neighbours, and the step up to the target level along them:
 * VP of Technology → CTO, Head of IT → VP of IT → CIO for a C-level candidate.
 */
function rolesOfWorkplace(text: string, targetRank: number): Role[] {
  const direct = rolesOfTitle(text);
  const adjacentOf = (role: Role) =>
    role.adjacent.flatMap((edge) => ontology.rolesById.get(edge.roleId) ?? []);
  const found = new Map([...direct, ...direct.flatMap(adjacentOf)].map((role) => [role.id, role]));
  const climbed = new Set(direct.map((role) => role.id));
  let frontier = direct;
  while (frontier.length > 0) {
    const higher = frontier.flatMap((role) =>
      adjacentOf(role).filter(
        (next) =>
          topRank(next) > topRank(role) && topRank(next) <= targetRank && !climbed.has(next.id),
      ),
    );
    frontier = [...new Map(higher.map((role) => [role.id, role])).values()];
    for (const role of frontier) {
      climbed.add(role.id);
      found.set(role.id, role);
    }
  }
  return [...found.values()];
}

/** A fact without a domain comes from an older caller and counts as a position statement. */
const domainOf = (fact: CampaignRoleFact) => fact.domain ?? 'role-evidence';

/**
 * A position held: an imported place of work, or a role statement that names a level. The
 * parser gives `ic` to any text without a level, so «Команда знает DevOps» is not a position.
 */
function isPosition(fact: CampaignRoleFact): boolean {
  if (fact.position) return true;
  if (domainOf(fact) !== 'role-evidence') return false;
  const rank = rulesParse(fact.statement).levelRank;
  return rank !== null && rank > LEVEL_RANK.ic;
}

interface RankInput {
  readonly facts: readonly CampaignRoleFact[];
  readonly profileTitle: string | null;
  readonly targetLevel: OntologyLevel;
  readonly dismissed: ReadonlySet<string>;
}

/** Roles held or neighbouring a held position, with the refs of the positions behind each. */
function positionSupport(
  input: RankInput,
  targetRank: number,
): Map<string, { role: Role; refs: string[]; count: number }> {
  const support = new Map<string, { role: Role; refs: string[]; count: number }>();
  const titled = [
    ...(input.profileTitle ? [{ ref: null, statement: input.profileTitle }] : []),
    ...input.facts.filter(isPosition).map((fact) => ({ ref: fact.ref, statement: fact.statement })),
  ];
  for (const workplace of titled) {
    for (const role of rolesOfWorkplace(workplace.statement, targetRank)) {
      const entry = support.get(role.id) ?? { role, refs: [], count: 0 };
      support.set(role.id, {
        role,
        refs: workplace.ref ? [...entry.refs, workplace.ref] : entry.refs,
        count: entry.count + 1,
      });
    }
  }
  return support;
}

/** Facts that are not positions, by the functions their text names. */
function factsByFunction(
  facts: readonly CampaignRoleFact[],
): Map<FunctionCode, CampaignRoleFact[]> {
  const byFunction = new Map<FunctionCode, CampaignRoleFact[]>();
  for (const fact of facts) {
    if (isPosition(fact) || !FACT_WEIGHT[domainOf(fact)]) continue;
    for (const code of rulesParse(fact.statement).functions) {
      byFunction.set(code, [...(byFunction.get(code) ?? []), fact]);
    }
  }
  return byFunction;
}

/** A function evidenced only by achievements or skills offers its role nearest the target level. */
function nearestFunctionRoles(codes: Iterable<FunctionCode>, targetRank: number): Role[] {
  return [...codes].flatMap((code) => {
    const roles = ontology.rolesByFunction.get(code) ?? [];
    const best = Math.min(...roles.map((role) => distance(role, targetRank)));
    return roles.filter((role) => distance(role, targetRank) === best);
  });
}

export function rankFallbackRoles(input: RankInput): RankedRole[] {
  const targetRank = LEVEL_RANK[input.targetLevel];
  const positions = positionSupport(input, targetRank);
  const byFunction = factsByFunction(input.facts);
  const heldFunctions = new Set(
    [input.profileTitle ?? '', ...input.facts.filter(isPosition).map((fact) => fact.statement)].flatMap(
      (text) => rulesParse(text).functions as readonly string[],
    ),
  );
  const roles = new Map(
    [
      ...[...positions.values()].map((entry) => entry.role),
      ...nearestFunctionRoles(byFunction.keys(), targetRank),
    ].map((role) => [role.id, role]),
  );
  const ranked = [...roles.values()]
    .filter((role) => !input.dismissed.has(role.id))
    // A neighbour in a function with no position and no fact is another job: a CCO is not a CMO.
    .filter(
      (role) => heldFunctions.has(role.function) || byFunction.has(role.function as FunctionCode),
    )
    .map((role) => {
      const facts = byFunction.get(role.function as FunctionCode) ?? [];
      const held = positions.get(role.id);
      const score =
        (held?.count ?? 0) * WORKPLACE_WEIGHT +
        facts.reduce((sum, fact) => sum + (FACT_WEIGHT[domainOf(fact)] ?? 0), 0);
      const tier = held
        ? POSITION_TIER
        : Math.max(0, ...facts.map((fact) => FACT_TIER[domainOf(fact)] ?? 0));
      const evidenceRefs = [
        ...new Set([...(held?.refs ?? []), ...facts.map((fact) => fact.ref)]),
      ].slice(0, 3);
      return { role, level: nearestLevel(role, targetRank), evidenceRefs, score, tier, held: Boolean(held) };
    })
    // A role with no position behind it and no fact of its function is not offered.
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.tier - a.tier ||
        distance(a.role, targetRank) - distance(b.role, targetRank) ||
        b.score - a.score ||
        a.role.titleEn.localeCompare(b.role.titleEn),
    );
  return ranked.map(({ role, level, evidenceRefs, held }) => ({ role, level, evidenceRefs, held }));
}
