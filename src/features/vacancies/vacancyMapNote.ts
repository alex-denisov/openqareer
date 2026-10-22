import { pluralWordRu } from '../../../shared/pluralRu';

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

const format = (value: number) => new Intl.NumberFormat('ru-RU').format(value);

/**
 * Заметка под картой (макет 4): «На карте 112 из 148: у остальных 36
 * удалённая работа, без точки». Пока выдача дочитывается — честно, что
 * разложены загруженные, и сколько ещё в пути (B446-r, W9).
 */
export function vacancyMapNote(counts: VacancyMapNoteCounts): string {
  const pending = counts.total - counts.shown;
  if (pending <= 0) {
    return `На карте ${format(counts.onMap)} из ${format(counts.shown)}${offMapReason(counts)} ${CLUSTERS_HINT}`;
  }
  return (
    `На карте ${format(counts.onMap)} из ${format(counts.shown)} загруженных` +
    `${offMapReason(counts)} Ещё ${format(pending)} ${pluralWordRu(pending, ['вакансия', 'вакансии', 'вакансий'])} из ${format(counts.total)} ${pluralWordRu(pending, ['догружается', 'догружаются', 'догружаются'])}. ${CLUSTERS_HINT}`
  );
}
