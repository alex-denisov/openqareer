import { createUsernamePresenceAdapter, type UsernamePresenceOptions } from './usernamePresenceAdapter';

export function createSherlockAdapter(options: UsernamePresenceOptions) {
  return createUsernamePresenceAdapter('sherlock', options);
}
