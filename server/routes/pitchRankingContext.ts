import { ontology } from '../../shared/roleOntology';
import type { FunctionCode } from '../../shared/roleTaxonomy';
import type { CandidateStore } from '../data/candidateStore';
import type { PitchFactRankingContext } from '../domain/pitchFactRanking';
import type { CampaignRoleProposal } from '../vacancies/campaignRoleSet';
import { LEVEL_RANK } from '../vacancies/levelMatcher';
import { normalizeTitleKey } from '../vacancies/titleParse/normalizeTitleKey';
import type { SqliteTitleParseStore } from '../vacancies/titleParse/sqliteTitleParseStore';
import { rulesParse } from '../vacancies/titleParse/rulesParse';
import { readCampaign } from './campaignContext';

function cachedOrRulesTitleParse(
  titleParseStore: Pick<SqliteTitleParseStore, 'getByKey'>,
  title: string,
): { readonly functions: readonly FunctionCode[]; readonly levelRank: number | null } {
  const titleKey = normalizeTitleKey(title) || title.toLocaleLowerCase();
  const stored = titleParseStore.getByKey(titleKey);
  return stored
    ? { functions: stored.functions, levelRank: stored.levelRank }
    : rulesParse(title);
}

function campaignRoleParse(role: CampaignRoleProposal) {
  const ontologyRole = ontology.rolesById.get(role.id);
  const levelRank = role.level === null ? null : LEVEL_RANK[role.level];
  return ontologyRole
    ? { functions: [ontologyRole.function as FunctionCode], levelRank }
    : { functions: rulesParse(role.title).functions, levelRank };
}

/** Роль кампании применима, только если её функция совпала с разбором вакансии. */
export function pitchRankingContext(
  candidateStore: CandidateStore,
  titleParseStore: Pick<SqliteTitleParseStore, 'getByKey'>,
  candidateId: string,
  vacancyTitle: string,
): PitchFactRankingContext | undefined {
  const vacancy = cachedOrRulesTitleParse(titleParseStore, vacancyTitle);
  if (vacancy.functions.length === 0 || vacancy.levelRank === null) return undefined;
  const stored = candidateStore.getCandidateWorkspace(candidateId);
  const selected = new Set(readCampaign(candidateStore, candidateId).roles.value);
  const selectedRole = stored?.campaign?.auto?.roles.find((item) => {
    const parsed = campaignRoleParse(item);
    return selected.has(item.title) && parsed.functions.some((code) => vacancy.functions.includes(code));
  });
  if (!selectedRole) return undefined;
  const role = campaignRoleParse(selectedRole);
  return {
    vacancy: { functions: vacancy.functions, levelRank: vacancy.levelRank },
    campaignRole: {
      functions: role.functions,
      levelRank: role.levelRank,
      evidenceRefs: selectedRole.evidenceRefs,
    },
  };
}
