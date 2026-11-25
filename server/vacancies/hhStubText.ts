/**
 * B794: before #1202 a card text stopped at its first nested block («Обязанности:» and nothing else),
 * and a stored text is never asked again. A text this short is asked once more: a card
 * that really is short costs one request and is marked `descriptionShort`, a cut one gets its requirements.
 */
export const HH_STUB_TEXT_CHARS = 300;

/** A short stored text nobody has read from the page since: one read per vacancy, kept in the pool. */
export function hhTextNeedsRead(vacancy: {
  readonly fullDescription?: string;
  readonly descriptionShort?: boolean;
}): boolean {
  if (!vacancy.fullDescription?.trim()) return true;
  return !vacancy.descriptionShort && isHhStubText(vacancy.fullDescription);
}

export function isHhStubText(text: string | undefined): boolean {
  const length = text?.trim().length ?? 0;
  return length < HH_STUB_TEXT_CHARS;
}
