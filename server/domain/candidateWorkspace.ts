import { z } from 'zod';

/**
 * The candidate's own answers to the diagnostic wizard — the part of the
 * workspace that no engine can recompute, because the candidate is the only
 * source of it. Derived analysis is deliberately not stored: it is rebuilt from
 * these inputs plus the dossier.
 */
export const candidateWorkspaceSchema = z
  .object({
    careerGoal: z
      .enum(['find-job', 'choose-role', 'positioning', 'market'])
      .optional(),
    resumeText: z.string().max(200_000),
    resumeSource: z.enum(['pdf', 'linkedin-pdf', 'hh-pdf', 'text']),
    resumeFileName: z.string().max(300).optional(),
    resumePageCount: z.number().int().min(0).max(1_000).optional(),
    targetDirection: z.string().max(500),
    market: z.enum(['ru', 'international']),
    currentSituation: z.string().max(20_000),
    constraints: z.string().max(20_000),
    urgency: z.enum(['exploring', 'active', 'urgent']),
    linkedinUrl: z.string().max(500).optional(),
    hhUrl: z.string().max(500).optional(),
    resumeImported: z.boolean().optional(),
  })
  .strict();

export type CandidateWorkspaceState = z.infer<typeof candidateWorkspaceSchema>;
