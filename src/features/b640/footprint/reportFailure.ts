/** Причина сбоя в консоль: нужна при разборе на проде, кандидату показываем строку ошибки. */
export function reportFailure(what: string, reason: unknown): void {
  // eslint-disable-next-line no-console -- причина сбоя нужна при разборе на проде
  console.error(`B640 «Цифровой след»: ${what}`, reason);
}
