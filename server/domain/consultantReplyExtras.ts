import {
  CONSULTANT_REPLY_MAX_ACTIONS,
  CONSULTANT_REPLY_MAX_LINKS,
  type ConsultantReplyAction,
  type ConsultantReplyExtras,
} from '../../shared/consultantReply';
import type { CoachTurnResult } from './coach';

/** Запись памяти кандидата: по ней проверяется, что ссылка ведёт на его запись. */
export interface ReplyMemory {
  readonly id: string;
  readonly sensitive: boolean;
}

/** Раздел кабинета, где делается предложенный шаг; шаги без экрана не показываются. */
const ACTION_OF_KIND: Readonly<Record<string, ConsultantReplyAction>> = {
  'resume.draft': 'profile',
  'resume.revise': 'profile',
  'career.role.add': 'career',
  'career.role.remove': 'career',
  'career.conditions.update': 'career',
  'vacancies.search': 'vacancies',
  'vacancies.local_query': 'vacancies',
  'company.evaluate': 'vacancies',
  'market.evaluate': 'vacancies',
  'cover_letter.draft': 'responses',
  'application.prepare': 'responses',
  'application.submit': 'responses',
};

const MEMORY_REF = /^memory:([A-Za-z0-9_-]{1,120})$/u;

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

function evidenceRefs(result: CoachTurnResult): string[] {
  const proposals = result.actionProposals.flatMap((proposal) => proposal.evidenceRefs);
  const contributions = (result.intelligence?.roleContributions ?? []).flatMap(
    (contribution) => contribution.evidenceRefs,
  );
  return [...proposals, ...contributions];
}

/**
 * B688: действия и ссылки под ответом консультанта из уже проверенного результата хода.
 * Промпт и модель не меняются: шаги берутся из `actionProposals`, ссылки — из их
 * доказательств, и только на несекретные записи этого кандидата.
 */
export function replyExtrasOf(
  result: CoachTurnResult,
  memory: readonly ReplyMemory[],
): Omit<ConsultantReplyExtras, 'messageId'> {
  const own = new Set(memory.filter((item) => !item.sensitive).map((item) => item.id));
  const actions = unique(
    result.actionProposals.flatMap((proposal) => ACTION_OF_KIND[proposal.kind] ?? []),
  ).slice(0, CONSULTANT_REPLY_MAX_ACTIONS);
  const memoryIds = unique(
    evidenceRefs(result).flatMap((ref) => {
      const id = MEMORY_REF.exec(ref)?.[1];
      return id && own.has(id) ? [id] : [];
    }),
  ).slice(0, CONSULTANT_REPLY_MAX_LINKS);
  return { actions, memoryIds };
}
