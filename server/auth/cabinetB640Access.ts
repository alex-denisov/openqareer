import type { ServerConfig } from '../config';
import { normalizeUsername } from './authCoreUtils';
import type { AuthPrincipal, CabinetFeatures } from './authTypes';

/**
 * B649: новый кабинет B640 включается по имени входа. Список приходит из
 * окружения (`OPENQAREER_CABINET_B640_USERNAMES`), по умолчанию пуст; `*`
 * включает всем. Наружу уходит только итог для своего аккаунта, не список.
 */
export const CABINET_B640_EVERYONE = '*';

export type CabinetB640Config = Pick<ServerConfig, 'cabinetB640Usernames'> &
  Partial<Pick<ServerConfig, 'interviewRecordingEnabled'>>;

/** Включён ли новый кабинет для имени входа. */
export function cabinetB640Enabled(
  config: CabinetB640Config,
  username: string | null | undefined,
): boolean {
  const usernames = config.cabinetB640Usernames ?? [];
  if (usernames.length === 0 || typeof username !== 'string') return false;
  const normalized = normalizeUsername(username);
  if (!normalized || normalized === CABINET_B640_EVERYONE) return false;
  return usernames.includes(CABINET_B640_EVERYONE) || usernames.includes(normalized);
}

/** Поле `features` в ответах входа и `/auth/me`. */
export function cabinetB640Features(
  config: CabinetB640Config,
  principal: Pick<AuthPrincipal, 'username'>,
): CabinetFeatures {
  return {
    cabinetB640: cabinetB640Enabled(config, principal.username),
    interviewRecording: config.interviewRecordingEnabled === true,
  };
}
