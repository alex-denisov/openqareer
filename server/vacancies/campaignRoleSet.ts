import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  ontology,
  ONTOLOGY_LEVELS,
  type OntologyLevel,
  type Role,
} from '../../shared/roleOntology';
import type { FunctionCode } from '../../shared/roleTaxonomy';
import { LEVEL_RANK } from './levelMatcher';
import { rulesParse } from './titleParse/rulesParse';
import { rankFallbackRoles } from './campaignRoleRanking';

export interface CampaignRoleFact {
  readonly ref: string;
  readonly statement: string;
  /** Dossier domain: a position (`role-evidence`) outranks an achievement, an achievement a skill. */
  readonly domain?: string;
  /** An imported place of work: it is a position whatever level its title names. */
  readonly position?: boolean;
}

/** Why a model answer or one of its roles was not used; the rebuild writes it to the log. */
export type CampaignRoleLog = (fields: Record<string, unknown>, message: string) => void;

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
  readonly candidates: readonly Readonly<
    Pick<Role, 'id' | 'function' | 'titleEn' | 'titleRu' | 'levels'>
  >[];
}

export interface CampaignRoleModel {
  readonly name?: string;
  propose(input: CampaignRoleModelInput): Promise<unknown>;
}

/** Bumped when the role rules change, so every stored auto list is rebuilt once (03.11 → v2). */
export const CAMPAIGN_ROLE_RULES_VERSION = 'roles-v2';

export function campaignFactsDigest(facts: readonly CampaignRoleFact[]): string {
  const input = [
    CAMPAIGN_ROLE_RULES_VERSION,
    ...facts.map((fact) => `${fact.ref}\0${fact.domain ?? ''}\0${fact.statement}`),
  ].join('\0');
  return createHash('sha256').update(input).digest('hex');
}

const modelRoleSchema = z
  .object({
    id: z.string().min(1),
    level: z.enum(ONTOLOGY_LEVELS),
    kind: z.enum(['primary', 'adjacent']),
    evidenceRefs: z.array(z.string().min(1)).min(1),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

const MIN_ROLES = 5;
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

function inferredLevel(
  facts: readonly CampaignRoleFact[],
  profileTitle: string | null,
): OntologyLevel {
  const ranks = [profileTitle ?? '', ...facts.map((fact) => fact.statement)]
    .map((text) => rulesParse(text).levelRank)
    .filter((rank): rank is number => rank !== null);
  const rank = ranks.length > 0 ? Math.max(...ranks) : LEVEL_RANK.ic;
  return ONTOLOGY_LEVELS.find((level) => LEVEL_RANK[level] === rank) ?? 'ic';
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
  facts: readonly CampaignRoleFact[],
  profileTitle: string | null,
  targetLevel: OntologyLevel,
  dismissed: ReadonlySet<string>,
): CampaignRoleProposal[] {
  // Without a fact behind it a role is not offered: a headline alone names no evidence ref.
  return rankFallbackRoles({ facts, profileTitle, targetLevel, dismissed })
    .filter(({ evidenceRefs }) => evidenceRefs.length > 0)
    .slice(0, MAX_ROLES)
    .map(({ role, level, evidenceRefs }, index) =>
      toProposal(
        role,
        level,
        index === 0 ? 'primary' : 'adjacent',
        evidenceRefs,
        'Роль выбрана по должностям и фактам профиля.',
      ),
    );
}

type ModelRole = z.infer<typeof modelRoleSchema>;

/** Why one model item cannot be used, or null when it can. */
function modelItemProblem(
  item: unknown,
  byId: ReadonlyMap<string, Role>,
  factRefs: ReadonlySet<string>,
  dismissed: ReadonlySet<string>,
  seen: ReadonlySet<string>,
): { readonly problem: string } | { readonly role: ModelRole } {
  const parsed = modelRoleSchema.safeParse(item);
  if (!parsed.success) return { problem: 'schema' };
  const { id, evidenceRefs } = parsed.data;
  if (!byId.has(id)) return { problem: 'unknown_role' };
  if (dismissed.has(id)) return { problem: 'dismissed' };
  if (seen.has(id)) return { problem: 'duplicate' };
  if (evidenceRefs.some((ref) => !factRefs.has(ref))) return { problem: 'unknown_evidence' };
  return { role: parsed.data };
}

/**
 * A wrong item drops only itself (03.11): one bad evidence ref used to throw away the whole
 * answer, and the rules list took over unnoticed. The rest is kept when five roles remain.
 */
function validateModelRoles(
  raw: unknown,
  candidates: readonly Role[],
  facts: readonly CampaignRoleFact[],
  dismissed: ReadonlySet<string>,
  log: CampaignRoleLog | undefined,
): CampaignRoleProposal[] | null {
  if (!Array.isArray(raw)) {
    log?.({ reason: 'not_array' }, 'campaign-role-model-rejected');
    return null;
  }
  const byId = new Map(candidates.map((role) => [role.id, role]));
  const factRefs = new Set(facts.map((fact) => fact.ref));
  const seen = new Set<string>();
  const dropped: string[] = [];
  const kept: ModelRole[] = [];
  for (const [index, item] of raw.entries()) {
    const checked = modelItemProblem(item, byId, factRefs, dismissed, seen);
    if ('problem' in checked) {
      dropped.push(`${index}:${checked.problem}`);
      continue;
    }
    seen.add(checked.role.id);
    kept.push(checked.role);
  }
  if (dropped.length > 0)
    log?.({ dropped, kept: kept.length }, 'campaign-role-model-items-dropped');
  // Short only because of the candidate's own dismissals: the answer is sound, rules fill the gap.
  const dismissedCount = dropped.filter((item) => item.endsWith(':dismissed')).length;
  if (kept.length < MIN_ROLES && (kept.length === 0 || kept.length + dismissedCount < MIN_ROLES)) {
    log?.({ reason: 'too_few_roles', kept: kept.length }, 'campaign-role-model-rejected');
    return null;
  }
  const primaryAt = kept.findIndex((item) => item.kind === 'primary');
  const primary = primaryAt >= 0 && primaryAt < MAX_ROLES ? primaryAt : 0;
  return kept
    .slice(0, MAX_ROLES)
    .map((item, index) =>
      toProposal(
        byId.get(item.id)!,
        item.level,
        index === primary ? 'primary' : 'adjacent',
        item.evidenceRefs,
        item.reason,
      ),
    );
}

/** Adds rules roles to a model answer left short by dismissals, up to the minimum. */
function withRulesRoles(
  modeled: readonly CampaignRoleProposal[],
  rules: readonly CampaignRoleProposal[],
): CampaignRoleProposal[] {
  const taken = new Set(modeled.map((role) => role.id));
  const added = rules
    .filter((role) => !taken.has(role.id))
    .slice(0, MIN_ROLES - modeled.length)
    .map((role) => ({ ...role, kind: 'adjacent' as const }));
  return [...modeled, ...added];
}

export async function buildCampaignRoleSet(input: {
  readonly facts: readonly CampaignRoleFact[];
  readonly profileTitle?: string | null;
  readonly dismissed?: readonly string[];
  readonly model?: CampaignRoleModel;
  readonly now?: () => Date;
  readonly log?: CampaignRoleLog;
}): Promise<StoredAutoCampaign> {
  const candidates = candidateRoles(input.facts, input.profileTitle ?? null);
  const dismissed = new Set(input.dismissed ?? []);
  const level = inferredLevel(input.facts, input.profileTitle ?? null);
  const raw =
    input.model && candidates.length > 0
      ? await input.model.propose({ facts: input.facts, candidates }).catch((error: unknown) => {
          input.log?.(
            {
              errorName: error instanceof Error ? error.name : 'UnknownError',
              errorMessage:
                error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
            },
            'campaign-role-model-failed',
          );
          return null;
        })
      : null;
  const modeled =
    raw === null ? null : validateModelRoles(raw, candidates, input.facts, dismissed, input.log);
  const needsRules = !modeled || modeled.length < MIN_ROLES;
  const rules = needsRules
    ? fallbackRoles(input.facts, input.profileTitle ?? null, level, dismissed)
    : [];
  const roles = modeled ? (needsRules ? withRulesRoles(modeled, rules) : modeled) : rules;
  const modelName = input.model?.name ?? 'model';
  if (modeled && needsRules) {
    input.log?.(
      { kept: modeled.length, added: roles.length - modeled.length },
      'campaign-role-model-topped-up',
    );
  }
  return {
    roles: roles.slice(0, MAX_ROLES),
    factsDigest: campaignFactsDigest(input.facts),
    generatedAt: (input.now?.() ?? new Date()).toISOString(),
    model: !modeled ? 'rules' : needsRules ? `${modelName}+rules` : modelName,
  };
}
