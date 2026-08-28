/** Names that would let one candidate look like the product to another. */
export const RESERVED_USERNAMES: readonly string[] = [
  'admin',
  'administrator',
  'root',
  'superuser',
  'system',
  'security',
  'support',
  'help',
  'moderator',
  'openqareer',
  'billing',
  'payments',
  'noreply',
  'no-reply',
  'postmaster',
  'webmaster',
];

export function isReservedUsername(username: string): boolean {
  const trimmed = username.trim().toLowerCase();
  if (!trimmed) return false;
  // Only the segment before the first dot decides: `admin.test` is reserved,
  // `administrator2` is not.
  const [firstSegment] = trimmed.split('.');
  return RESERVED_USERNAMES.includes(firstSegment);
}
