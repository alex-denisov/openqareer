import {
  CONSULTANT_REPLY_MAX_ACTIONS,
  CONSULTANT_REPLY_MAX_LINKS,
  isConsultantReplyAction,
  type ConsultantReplyAction,
  type ConsultantReplyExtras,
} from '../../../../shared/consultantReply';
import type { CandidateMemory } from '../../coach/coachApi';
import type { IconName } from '../kit/Icon';
import { buildNodePath } from '../routes';

export type { ConsultantReplyAction, ConsultantReplyExtras };

export interface ReplyActionLink {
  readonly label: string;
  readonly icon: IconName;
  readonly to: string;
}

const ACTION_LINK: Readonly<Record<ConsultantReplyAction, ReplyActionLink>> = {
  profile: { label: 'Открыть в профиле', icon: 'profile', to: buildNodePath('s01') },
  career: { label: 'Открыть «Карьеру»', icon: 'career', to: buildNodePath('s09') },
  vacancies: { label: 'Открыть вакансии', icon: 'search', to: buildNodePath('s07') },
  responses: { label: 'Открыть отклики', icon: 'send', to: buildNodePath('o01') },
};

export function actionLink(action: ConsultantReplyAction): ReplyActionLink {
  return ACTION_LINK[action];
}

function strings(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.length > 0)
    .slice(0, max);
}

/** Действия и ссылки из ответа сервера: неизвестные действия и пустые строки отбрасываются. */
export function readReplies(value: unknown): ConsultantReplyExtras[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ConsultantReplyExtras[] => {
    if (!item || typeof item !== 'object') return [];
    const { messageId, actions, memoryIds } = item as Record<string, unknown>;
    if (typeof messageId !== 'string' || !messageId) return [];
    const known = Array.isArray(actions) ? actions.filter(isConsultantReplyAction) : [];
    return [
      {
        messageId,
        actions: [...new Set(known)].slice(0, CONSULTANT_REPLY_MAX_ACTIONS),
        memoryIds: strings(memoryIds, CONSULTANT_REPLY_MAX_LINKS),
      },
    ];
  });
}

/** Записи под ответом: только те, что есть в снимке самого кандидата и не секретны. */
export function linkedRecords(
  extras: ConsultantReplyExtras,
  memory: readonly CandidateMemory[],
): CandidateMemory[] {
  const byId = new Map(memory.filter((item) => !item.sensitive).map((item) => [item.id, item]));
  return extras.memoryIds.flatMap((id) => byId.get(id) ?? []);
}
