import { prefetch } from './prefetch';
import { apiFetch, readData } from '../../coach/apiClient';

/** n02 «Как часто»: почта и Telegram — сразу, сводкой раз в день или раз в неделю. */
export type DeliveryFrequency = 'immediate' | 'daily' | 'weekly';

export interface DeliverySettings {
  readonly frequency: DeliveryFrequency;
  /** «Не показывать название компании» в письме и Telegram. */
  readonly hideCompany: boolean;
}

const PATH = '/api/v1/candidate/b640/notifications/preferences/delivery';

async function fetchDeliverySettings(): Promise<DeliverySettings> {
  return readData<DeliverySettings>(await apiFetch(PATH));
}

/** n02 начинает это чтение вместе со своим; группа «Как присылать» берёт его готовым. */
export const deliverySettingsRead = prefetch(fetchDeliverySettings);

export function getDeliverySettings(): Promise<DeliverySettings> {
  return deliverySettingsRead.read();
}

export async function putDeliverySettings(settings: DeliverySettings): Promise<DeliverySettings> {
  return readData<DeliverySettings>(
    await apiFetch(PATH, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    }),
  );
}
