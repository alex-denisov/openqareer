/**
 * Волны вместо залпа.
 *
 * Прод 2026-09-06: ручной опрос поднял 195 включённых источников одновременно,
 * и 92 доски работодателей ответили `The operation was aborted due to timeout`.
 * Молчали не они — продукт забил себе канал сам, а потом записал чужим
 * площадкам отказ, которого не было (B202, B204).
 */
export async function mapWithConcurrency<TItem, TResult>(
  items: readonly TItem[],
  limit: number,
  run: (item: TItem) => Promise<TResult>,
): Promise<TResult[]> {
  const width = Math.max(1, Math.floor(limit));
  const results = new Array<TResult>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await run(items[index]!);
    }
  }

  await Promise.all(Array.from({ length: Math.min(width, items.length) }, () => worker()));
  return results;
}
