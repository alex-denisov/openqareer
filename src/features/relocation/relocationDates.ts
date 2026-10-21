const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/u;

function localParts(value: string): readonly [string, string, string] | null {
  const dateOnly = DATE_ONLY.exec(value);
  if (dateOnly) return [dateOnly[1] ?? '', dateOnly[2] ?? '', dateOnly[3] ?? ''];
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  const pad = (part: number) => String(part).padStart(2, '0');
  return [String(date.getFullYear()), pad(date.getMonth() + 1), pad(date.getDate())];
}

/**
 * Day in the candidate's local time as ДД.ММ.ГГГГ. A calendar date (YYYY-MM-DD)
 * is shown as is; a timestamp is converted from UTC to the local day first.
 */
export function relocationDay(value: string | null | undefined): string {
  if (!value) return 'неизвестно';
  const parts = localParts(value);
  return parts ? `${parts[2]}.${parts[1]}.${parts[0]}` : value;
}

/** Short form ДД.ММ of the same local day. */
export function relocationShortDay(value: string | null | undefined): string {
  if (!value) return 'неизвестно';
  const parts = localParts(value);
  return parts ? `${parts[2]}.${parts[1]}` : value;
}

/** Today's calendar date in the candidate's local time zone, YYYY-MM-DD. */
export function localIsoDate(now: Date = new Date()): string {
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
