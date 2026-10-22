/**
 * Подбор считается по всему пулу (тысячи вакансий) — дорого, а клиент читает
 * его страницами подряд. Одно посчитанное значение кандидата служит всем
 * страницам одного чтения. Ключ несёт всё, от чего значение зависит; окно
 * ограничивает отставание от фонового воркера.
 *
 * На кандидата — одна запись: память не растёт с перебором фильтров.
 */
export function createCandidateWindowCache<V>(
  windowMs: number,
  now: () => number = () => Date.now(),
) {
  const entries = new Map<string, { key: string; at: number; value: V }>();
  const candidateOf = (key: string) => key.slice(0, key.indexOf('|'));
  return {
    read(key: string, compute: () => V): V {
      const entry = entries.get(candidateOf(key));
      if (entry && entry.key === key && now() - entry.at < windowMs) return entry.value;
      const value = compute();
      entries.set(candidateOf(key), { key, at: now(), value });
      return value;
    },
    /** Значение того же ключа любой давности: `stale` — окно вышло, пора пересчитать. */
    peek(key: string): { value: V; stale: boolean } | undefined {
      const entry = entries.get(candidateOf(key));
      if (!entry || entry.key !== key) return undefined;
      return { value: entry.value, stale: now() - entry.at >= windowMs };
    },
    write(key: string, value: V): void {
      entries.set(candidateOf(key), { key, at: now(), value });
    },
    size: () => entries.size,
  };
}
