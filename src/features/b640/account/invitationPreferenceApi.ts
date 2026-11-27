import { apiFetch, readData } from '../../coach/apiClient';
import type {
  NotificationChannelPreference,
  NotificationPreferenceKey,
} from '../../account/notificationPreferencesApi';

/** B671: ключ «Приглашения» живёт в новом кабинете, рядом с прежними ключами событий. */
export const INVITATION_KEY = 'ev-invitation';
export type B640PreferenceKey = NotificationPreferenceKey | typeof INVITATION_KEY;

export interface B640ChannelPreference extends Omit<NotificationChannelPreference, 'key'> {
  readonly key: B640PreferenceKey;
}

const PATH = '/api/v1/candidate/b640/notifications/preferences/invitations';

export async function getInvitationPreference(): Promise<B640ChannelPreference> {
  return readData<B640ChannelPreference>(await apiFetch(PATH));
}

export async function putInvitationPreference(
  preference: Omit<B640ChannelPreference, 'key'>,
): Promise<B640ChannelPreference> {
  return readData<B640ChannelPreference>(
    await apiFetch(PATH, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(preference),
    }),
  );
}
