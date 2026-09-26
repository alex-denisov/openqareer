import { z } from 'zod';
import {
  CANDIDATE_REGIONS,
  normalizeCandidateRegions,
  regionsFromLegacyMarket,
} from '../../src/features/workspace/candidateRegions';
import { ONTOLOGY_LEVELS } from '../../shared/roleOntology';

const campaignRoleProposalSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  titleRu: z.string().trim().min(1).max(200),
  functions: z.array(z.string().min(1)).min(1).max(2),
  level: z.enum(ONTOLOGY_LEVELS).nullable(),
  kind: z.enum(['primary', 'adjacent']),
  synonyms: z.array(z.string().trim().min(1).max(200)).max(6),
  evidenceRefs: z.array(z.string().min(1)).min(1),
  reason: z.string().trim().min(1).max(500),
}).strict();

/**
 * The candidate's own answers to the diagnostic wizard — the part of the
 * workspace that no engine can recompute, because the candidate is the only
 * source of it. Derived analysis is deliberately not stored: it is rebuilt from
 * these inputs plus the dossier.
 */
export const candidateWorkspaceSchema = z
  .object({
    careerGoal: z.enum(['find-job', 'choose-role', 'positioning', 'market']).optional(),
    resumeText: z.string().max(200_000),
    resumeSource: z.enum(['pdf', 'linkedin-pdf', 'hh-pdf', 'text']),
    resumeFileName: z.string().max(300).optional(),
    resumePageCount: z.number().int().min(0).max(1_000).optional(),
    targetDirection: z.string().max(500),
    /**
     * Where the candidate looks for work. Several regions at once are normal
     * and an empty list is honest — it means they have not said yet (B158).
     */
    regions: z.array(z.enum(CANDIDATE_REGIONS)).max(CANDIDATE_REGIONS.length),
    currentSituation: z.string().max(20_000),
    constraints: z.string().max(20_000),
    urgency: z.enum(['exploring', 'active', 'urgent']),
    linkedinUrl: z.string().max(500).optional(),
    hhUrl: z.string().max(500).optional(),
    resumeImported: z.boolean().optional(),
    /** Candidate-local visit marks used by the Today digest; kept with the encrypted workspace JSON. */
    lastVisitedAt: z.string().datetime().optional(),
    previousVisitedAt: z.string().datetime().optional(),
    /**
     * The candidate's own explicit choice of what the matcher searches for —
     * "кампания" (B247). Absent means the candidate has not chosen yet, and
     * `resolveCampaign` falls back to the profile; this is additive to rows
     * written before it, so no migration.
     */
    campaign: z
      .object({
        roles: z.array(z.string().trim().min(1).max(200)).max(10),
        regions: z.array(z.enum(CANDIDATE_REGIONS)).max(CANDIDATE_REGIONS.length),
        remoteOnly: z.boolean().optional(),
        revision: z.number().int().min(1),
        updatedAt: z.string(),
        auto: z.object({
          roles: z.array(campaignRoleProposalSchema).max(10),
          factsDigest: z.string().min(1),
          generatedAt: z.string(),
          model: z.string().min(1),
        }).strict().optional(),
        dismissed: z.array(z.string().min(1)).max(451).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type CandidateWorkspaceState = z.infer<typeof candidateWorkspaceSchema>;

/**
 * Reads a row that an earlier release may have written.
 *
 * Before B158 the answer to «where are you looking?» was one `market` flag.
 * The write path no longer accepts it, but rows written under it still exist,
 * and a strict parse of those rows would answer every returning candidate with
 * a 500 instead of their own career context. `ru` named exactly one region;
 * `international` named none, so expanding it would invent an answer.
 */
export function readStoredCandidateWorkspace(raw: unknown): CandidateWorkspaceState {
  return candidateWorkspaceSchema.parse(withRegions(raw));
}

function withRegions(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const record = raw as Record<string, unknown>;
  if (!('market' in record)) return record;
  const { market, regions, ...rest } = record;
  return {
    ...rest,
    regions: Array.isArray(regions)
      ? normalizeCandidateRegions(regions)
      : regionsFromLegacyMarket(market),
  };
}
