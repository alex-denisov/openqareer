import { apiFetch, readData } from '../../coach/apiClient';
import { getIncome } from '../profile/profileExtrasApi';
import { loadRoles, type RolesData } from './careerApi';
import type { ProfessionRequirement } from './professionPathModel';

const PATH_API = '/api/v1/candidate/career/profession-path';

export type LowerIncomeAnswer = 'yes' | 'no' | 'depends';

export type ProfessionWage =
  | {
      readonly state: 'ready';
      readonly min: number;
      readonly max: number;
      readonly sampleSize: number;
      readonly observedAt: string;
    }
  | { readonly state: 'thin'; readonly sampleSize: number };

export type ProfessionPath =
  | { readonly state: 'no_target' }
  | { readonly state: 'source_unavailable'; readonly target: string }
  | {
      readonly state: 'too_few';
      readonly target: string;
      readonly sampleSize: number;
      readonly threshold: number;
    }
  | {
      readonly state: 'ready';
      readonly target: string;
      readonly sampleSize: number;
      readonly observedAt: string;
      readonly requirements: readonly ProfessionRequirement[];
      readonly wage: ProfessionWage;
      readonly responses: { readonly sent: number; readonly invited: number };
      readonly lowerIncome: LowerIncomeAnswer | null;
    };

export interface ProfessionData {
  readonly path: ProfessionPath;
  /** Роли по профилю — из них выбирается промежуточная; сбой не мешает пути. */
  readonly roles: RolesData | null;
  /** Нынешний доход на руки из профиля; `null` — не указан или не прочитан. */
  readonly currentIncome: number | null;
}

export async function getProfessionPath(signal?: AbortSignal): Promise<ProfessionPath> {
  return readData<ProfessionPath>(await apiFetch(PATH_API, { signal }));
}

export async function loadProfession(signal: AbortSignal): Promise<ProfessionData> {
  const [path, roles, income] = await Promise.all([
    getProfessionPath(signal),
    loadRoles(signal).catch(() => null),
    getIncome(signal).catch(() => null),
  ]);
  return { path, roles, currentIncome: income?.current ?? null };
}

export async function saveLowerIncome(answer: LowerIncomeAnswer): Promise<LowerIncomeAnswer> {
  const response = await apiFetch(`${PATH_API}/lower-income`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answer }),
  });
  return (await readData<{ lowerIncome: LowerIncomeAnswer }>(response)).lowerIncome;
}
