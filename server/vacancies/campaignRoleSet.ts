import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ontology, ONTOLOGY_LEVELS, type OntologyLevel, type Role } from '../../shared/roleOntology';
import type { FunctionCode } from '../../shared/roleTaxonomy';
import { LEVEL_RANK } from './levelMatcher';
import { rulesParse } from './titleParse/rulesParse';

export interface CampaignRoleFact {
  readonly ref: string;
  readonly statement: string;
}

export interface CampaignRoleProposal {
  readonly id: string;
  readonly title: string;
  readonly titleRu: string;
  readonly functions: readonly string[];
  readonly level: OntologyLevel | null;
  readonly kind: 'primary' | 'adjacent';
  readonly synonyms: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly reason: string;
}

export interface StoredAutoCampaign {
  readonly roles: readonly CampaignRoleProposal[];
  readonly factsDigest: string;
  readonly generatedAt: string;
  readonly model: string;
}

export interface CampaignRoleModelInput {
  readonly facts: readonly CampaignRoleFact[];
  readonly candidates: readonly Readonly<Pick<Role, 'id' | 'function' | 'titleEn' | 'titleRu' | 'levels'>>[];
}

export interface CampaignRoleModel {
  readonly name?: string;
  propose(input: CampaignRoleModelInput): Promise<unknown>;
}

export function campaignFactsDigest(facts: readonly CampaignRoleFact[]): string {
  const input = facts.map((fact) => `${fact.ref}\0${fact.statement}`).join('\0');
  return createHash('sha256').update(input).digest('hex');
}

const modelRoleSchema = z.object({
  id: z.string().min(1),
  level: z.enum(ONTOLOGY_LEVELS),
  kind: z.enum(['primary', 'adjacent']),
  evidenceRefs: z.array(z.string().min(1)).min(1),
  reason: z.string().trim().min(1).max(500),
}).strict();

const MAX_ROLES = 10;

function candidateRoles(facts: readonly CampaignRoleFact[], profileTitle: string | null): Role[] {
  const functions = new Set<FunctionCode>();
  for (const text of [profileTitle ?? '', ...facts.map((fact) => fact.statement)]) {
    for (const code of rulesParse(text).functions) functions.add(code);
  }
  const direct = [...functions].flatMap((code) => ontology.rolesByFunction.get(code) ?? []);
  const adjacent = direct.flatMap((role) =>
    role.adjacent.flatMap((edge) => ontology.rolesById.get(edge.roleId) ?? []),
  );
  return [...new Map([...direct, ...adjacent].map((role) => [role.id, role])).values()];
}

function inferredLevel(facts: readonly CampaignRoleFact[], profileTitle: string | null): OntologyLevel {
  const ranks = [profileTitle ?? '', ...facts.map((fact) => fact.statement)]
    .map((text) => rulesParse(text).levelRank)
    .filter((rank): rank is number => rank !== null);
  const rank = ranks.length > 0 ? Math.max(...ranks) : LEVEL_RANK.ic;
  return ONTOLOGY_LEVELS.find((level) => LEVEL_RANK[level] === rank) ?? 'ic';
}

function evidenceFor(role: Role, facts: readonly CampaignRoleFact[]): string[] {
  const matching = facts.filter((fact) => rulesParse(fact.statement).functions.includes(role.function as FunctionCode));
  return (matching.length > 0 ? matching : facts).slice(0, 3).map((fact) => fact.ref);
}

function toProposal(
  role: Role,
  level: OntologyLevel,
  kind: 'primary' | 'adjacent',
  evidenceRefs: readonly string[],
  reason: string,
): CampaignRoleProposal {
  return {
    id: role.id,
    title: role.titleEn,
    titleRu: role.titleRu,
    functions: [role.function as FunctionCode],
    level,
    kind,
    synonyms: [...role.variants.en, ...role.variants.ru].slice(0, 6),
    evidenceRefs: [...evidenceRefs],
    reason,
  };
}

function fallbackRoles(
  candidates: readonly Role[],
  facts: readonly CampaignRoleFact[],
  targetLevel: OntologyLevel,
  dismissed: ReadonlySet<string>,
): CampaignRoleProposal[] {
  const targetRank = LEVEL_RANK[targetLevel];
  const ranked = candidates
    .filter((role) => !dismissed.has(role.id))
    .map((role) => {
      const level = role.levels.reduce((best, item) =>
        Math.abs(LEVEL_RANK[item as OntologyLevel] - targetRank) < Math.abs(LEVEL_RANK[best as OntologyLevel] - targetRank)
          ? item : best,
      ) as OntologyLevel;
      return { role, level, distance: Math.abs(LEVEL_RANK[level] - targetRank) };
    })
    .sort((a, b) => a.distance - b.distance || a.role.titleEn.localeCompare(b.role.titleEn));
  return ranked.slice(0, MAX_ROLES).map(({ role, level }, index) =>
    toProposal(
      role,
      level,
      index === 0 ? 'primary' : 'adjacent',
      evidenceFor(role, facts),
      'Роль выбрана по должностям и фактам профиля.',
    ),
  );
}

function validateModelRoles(
  raw: unknown,
  candidates: readonly Role[],
  facts: readonly CampaignRoleFact[],
  dismissed: ReadonlySet<string>,
): CampaignRoleProposal[] | null {
  const parsed = z.array(modelRoleSchema).min(4).max(MAX_ROLES).safeParse(raw);
  if (!parsed.success) return null;
  const byId = new Map(candidates.map((role) => [role.id, role]));
  const factRefs = new Set(facts.map((fact) => fact.ref));
  if (parsed.data.filter((item) => item.kind === 'primary').length !== 1) return null;
  if (parsed.data.some((item) => !byId.has(item.id) || dismissed.has(item.id) || item.evidenceRefs.some((ref) => !factRefs.has(ref)))) return null;
  const unique = [...new Map(parsed.data.map((item) => [item.id, item])).values()];
  return unique.map((item) => toProposal(byId.get(item.id)!, item.level, item.kind, item.evidenceRefs, item.reason));
}

export async function buildCampaignRoleSet(input: {
  readonly facts: readonly CampaignRoleFact[];
  readonly profileTitle?: string | null;
  readonly dismissed?: readonly string[];
  readonly model?: CampaignRoleModel;
  readonly now?: () => Date;
}): Promise<StoredAutoCampaign> {
  const candidates = candidateRoles(input.facts, input.profileTitle ?? null);
  const dismissed = new Set(input.dismissed ?? []);
  const level = inferredLevel(input.facts, input.profileTitle ?? null);
  const raw = input.model && candidates.length > 0
    ? await input.model.propose({ facts: input.facts, candidates }).catch(() => null)
    : null;
  const modeled = raw === null ? null : validateModelRoles(raw, candidates, input.facts, dismissed);
  const roles = modeled ?? fallbackRoles(candidates, input.facts, level, dismissed);
  return {
    roles: roles.slice(0, MAX_ROLES),
    factsDigest: campaignFactsDigest(input.facts),
    generatedAt: (input.now?.() ?? new Date()).toISOString(),
    model: modeled ? (input.model?.name ?? 'model') : 'rules',
  };
}
