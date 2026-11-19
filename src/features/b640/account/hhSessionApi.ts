import { apiFetch, readData } from '../../coach/apiClient';

/** B690: истёк ли вход в hh.ru; `since` — когда это обнаружилось. */
export interface HhSessionState {
  readonly expired: boolean;
  readonly since: string | null;
}

export async function getHhSessionState(): Promise<HhSessionState> {
  const response = await apiFetch('/api/v1/candidate/b640/hh/session');
  return readData<HhSessionState>(response);
}
