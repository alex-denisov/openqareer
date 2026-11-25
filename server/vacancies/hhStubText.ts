/**
 * B794: before #1202 a card text stopped at its first nested block («Обязанности:» and nothing else),
 * and a stored text is never asked again. A text this short is asked once more per process: a card
 * that really is short costs one request, a cut one gets its requirements.
 */
export const HH_STUB_TEXT_CHARS = 300;

export function isHhStubText(text: string | undefined): boolean {
  const length = text?.trim().length ?? 0;
  return length < HH_STUB_TEXT_CHARS;
}
