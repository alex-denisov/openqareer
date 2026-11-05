const MIN_REPLY_WORDS = 3;
/** Так заканчивается только оборванная фраза: на букве, запятой, тире или двоеточии. */
const UNFINISHED_ENDING = /[\p{L},;:—–-]$/u;

/**
 * Реплика, которую можно показать кандидату. Модель иногда закрывает JSON посреди фразы
 * или отвечает обрывком: на проде 05.11 — «повышает риск кажущейся» и «Вы спрашиваете...?».
 */
export function isFinishedReply(message: string): boolean {
  const text = message.trim();
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.length >= MIN_REPLY_WORDS && !UNFINISHED_ENDING.test(text);
}

/** Проверка для очереди моделей: `CoachTurnOptions.prefer`. */
export function preferFinishedReply(result: { readonly message: string }): boolean {
  return isFinishedReply(result.message);
}
