import { createUsernamePresenceAdapter, type UsernamePresenceOptions } from './usernamePresenceAdapter';

export function createMaigretAdapter(options: UsernamePresenceOptions) {
  return createUsernamePresenceAdapter('maigret', options);
}
