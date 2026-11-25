/** Чужой текст вопросов анкеты: общие пределы и чистка. */
export const QUESTION_TEXT_MAX_LENGTH = 500;
export const OPTION_MAX_LENGTH = 200;

export function clip(value: string, max: number): string {
  // Управляющие символы и символы смены направления текста в чужом тексте не нужны.
  const flat = value
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
