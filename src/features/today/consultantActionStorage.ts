import type { ReasonedCareerAction } from '../next-action/careerActionPolicy';

/**
 * Идентификатор решения дня. Состояние «принято / отклонено / отложено» хранит сервер
 * по паре «id решения + дата» (C3), в браузере оно больше не живёт.
 */

export function todayActionId(action: ReasonedCareerAction): string {
  const identity = JSON.stringify({
    revision: action.revision,
    type: action.type,
    destination: action.destination,
    findingIds: [...action.findingIds].sort(),
    roleIds: [...action.roleIds].sort(),
    marketIds: [...action.marketIds].sort(),
  });
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(identity)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}
