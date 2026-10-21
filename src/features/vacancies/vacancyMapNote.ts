export interface VacancyMapNoteCounts {
  readonly onMap: number;
  /** Сколько строк выдачи загружено и разложено по карте. */
  readonly shown: number;
  /** Вся выдача с условиями кандидата (сервер). */
  readonly total: number;
  readonly remoteOffMap: number;
  readonly missingCity: number;
  readonly unresolvedCity: number;
}

const CLUSTERS_HINT = 'Кластеры разбиваются при приближении.';

function offMapReason(counts: VacancyMapNoteCounts): string {
  const rest = counts.shown - counts.onMap;
  if (rest <= 0) return '.';
  if (rest === counts.remoteOffMap) {
    return `: у остальных ${counts.remoteOffMap} удалённая работа, без точки.`;
  }
  const parts = [
    counts.remoteOffMap > 0 ? `${counts.remoteOffMap} с удалённой работой` : '',
    counts.missingCity > 0 ? `${counts.missingCity} без города` : '',
    counts.unresolvedCity > 0 ? `${counts.unresolvedCity} с нераспознанным городом` : '',
  ].filter(Boolean);
  return `: без точки ${parts.join(', ')}.`;
}

/** Заметка под картой (макет 4): числа из выдачи, без округлений и догадок. */
export function vacancyMapNote(counts: VacancyMapNoteCounts): string {
  const partial =
    counts.total > counts.shown ? ` Отмечены загруженные ${counts.shown} из ${counts.total}.` : '';
  return `На карте ${counts.onMap} из ${counts.shown}${offMapReason(counts)}${partial} ${CLUSTERS_HINT}`;
}
