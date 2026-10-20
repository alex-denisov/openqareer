import type {
  CandidateMemory,
  FactProvenance,
  ImportedSourceSummary,
  ImportWalk,
} from '../coach/coachApi';
import { PLATFORM_LABELS } from '../connections/platformLabels';
import { importDateLabel } from './profileSourceLabels';

/** Макет 2: «из LinkedIn, 12.09», «со слов кандидата», «выведено консультантом, беседа 06.10». */
export function provenanceLabel(provenance: FactProvenance | undefined): string {
  if (!provenance) return 'источник неизвестен';
  const date = importDateLabel(provenance.at);
  if (provenance.kind === 'candidate') return 'со слов кандидата';
  if (provenance.kind === 'consultant')
    return date ? `выведено консультантом, беседа ${date}` : 'выведено консультантом';
  const origin =
    provenance.platform === 'file'
      ? 'из файла резюме'
      : `из ${PLATFORM_LABELS[provenance.platform]}`;
  return date ? `${origin}, ${date}` : origin;
}

/** «8 из 9 · 07.10»: kept facts of the import against everything it brought. */
export function sourceCountLabel(
  source: Pick<ImportedSourceSummary, 'factCount' | 'keptFactCount' | 'lastImportedAt'>,
): string {
  const kept = source.keptFactCount ?? source.factCount;
  const date = importDateLabel(source.lastImportedAt);
  return [`${kept} из ${source.factCount}`, date].filter(Boolean).join(' · ');
}

/** «Курсы не найдены ни в LinkedIn, ни в hh.ru» names only the sources actually imported. */
export function coursesNotFoundLead(
  sources: readonly Pick<ImportedSourceSummary, 'platform'>[] | undefined,
): string {
  const names = (sources ?? []).map((item) => PLATFORM_LABELS[item.platform]);
  if (!names.length) return 'Курсы пока не добавлены.';
  if (names.length === 1) return `Курсы не найдены в ${names[0]}.`;
  return `Курсы не найдены ни в ${names.slice(0, -1).join(', ни в ')}, ни в ${names.at(-1)}.`;
}

export function walkReadCount(walk: ImportWalk): number {
  return walk.sections.filter((section) => section.status === 'read').length;
}

/** «LinkedIn: читаем разделы, 3 из 7» during the walk, «LinkedIn: прочитано 3 из 7, 20.10» after. */
export function walkHeadline(walk: ImportWalk): string {
  const label = PLATFORM_LABELS[walk.platform];
  const count = `${walkReadCount(walk)} из ${walk.sections.length}`;
  if (walk.state === 'running') return `${label}: читаем разделы, ${count}`;
  const date = importDateLabel(walk.updatedAt);
  return `${label}: прочитано ${count}${date ? `, ${date}` : ''}`;
}

/**
 * «Обо мне» has no memory id: the text is attributed to the import whose fact
 * holds the very same words; any other text was written by the candidate.
 */
export function aboutProvenance(
  about: string | undefined,
  memory: readonly CandidateMemory[],
): FactProvenance | undefined {
  const text = about?.trim();
  if (!text) return undefined;
  const match = memory.find((entry) => entry.statement.trim() === text);
  if (match) return match.provenance;
  return { kind: 'candidate', at: new Date(0).toISOString() };
}

/** Макет 2, 390 «Источник»: «LinkedIn, 12.09» / «Со слов кандидата». */
export function provenanceSourceValue(provenance: FactProvenance | undefined): string {
  if (provenance?.kind === 'import' && provenance.platform !== 'file') {
    const date = importDateLabel(provenance.at);
    return [PLATFORM_LABELS[provenance.platform], date].filter(Boolean).join(', ');
  }
  const label = provenanceLabel(provenance);
  return label.charAt(0).toLocaleUpperCase('ru-RU') + label.slice(1);
}
