import type { RouteDeps } from '../routes/deps';
import { buildCampaignRoleSet, campaignFactsDigest } from './campaignRoleSet';

/** Пересборка меняет только машинную часть кампании. */
export async function rebuildCampaignRoles(
  deps: Pick<RouteDeps, 'candidateStore' | 'campaignRoleModel'>,
  candidateId: string,
  options: { readonly force?: boolean } = {},
): Promise<void> {
  const before = deps.candidateStore.getCandidateWorkspace(candidateId);
  if (!before) return;
  const snapshot = deps.candidateStore.getSnapshot(candidateId);
  const facts = (snapshot?.memory ?? [])
    .map((fact) => ({ ref: `memory:${fact.id}`, statement: fact.statement }));
  if (!options.force && before.campaign?.auto?.factsDigest === campaignFactsDigest(facts)) return;
  const auto = await buildCampaignRoleSet({
    facts,
    profileTitle: snapshot?.resume?.draft.targetRole ?? before.targetDirection,
    dismissed: before.campaign?.dismissed,
    model: deps.campaignRoleModel,
  });
  const latest = deps.candidateStore.getCandidateWorkspace(candidateId);
  if (!latest) return;
  deps.candidateStore.saveCandidateWorkspace(candidateId, {
    ...latest,
    campaign: {
      roles: latest.campaign?.roles ?? [],
      regions: latest.campaign?.regions ?? latest.regions,
      revision: latest.campaign?.revision ?? 1,
      updatedAt: latest.campaign?.updatedAt ?? new Date().toISOString(),
      ...(latest.campaign?.dismissed ? { dismissed: latest.campaign.dismissed } : {}),
      auto: {
        ...auto,
        roles: auto.roles.map((role) => ({
          ...role,
          functions: [...role.functions],
          synonyms: [...role.synonyms],
          evidenceRefs: [...role.evidenceRefs],
        })),
      },
    },
  });
}
