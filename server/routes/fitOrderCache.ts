/**
 * Порядок по соответствию считается по всему пулу (тысячи вакансий) — дорого:
 * 7–10 с на страницу. Клиент читает подборку страницами подряд, поэтому один
 * посчитанный порядок кандидата служит всем страницам одного чтения. Ключ
 * несёт отпечаток профиля и размер пула; окно ограничивает отставание
 * процентов от фонового воркера.
 */
export function createFitOrderCache<T>(windowMs: number, now: () => number = Date.now) {
  const entries = new Map<string, { key: string; at: number; items: readonly T[] }>();
  return {
    read(key: string, compute: () => readonly T[]): readonly T[] {
      const candidate = key.slice(0, key.indexOf('|'));
      const entry = entries.get(candidate);
      if (entry && entry.key === key && now() - entry.at < windowMs) return entry.items;
      const items = compute();
      entries.set(candidate, { key, at: now(), items });
      return items;
    },
    size: () => entries.size,
  };
}
