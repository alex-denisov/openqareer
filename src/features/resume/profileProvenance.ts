import type {
  CandidateMemory,
  FactProvenance,
  ImportedSourceSummary,
  ImportWalk,
} from '../coach/coachApi';
import { PLATFORM_LABELS } from '../connections/platformLabels';
import { importDateLabel } from './profileSourceLabels';
import type { ResumeDraft } from './resumeTypes';

/** Макет 2: «из LinkedIn, 12.09», «со слов кандидата», «консультант 06.10» (B541, кратко). */
export function provenanceLabel(provenance: FactProvenance | undefined): string {
  if (!provenance) return 'источник неизвестен';
  const date = importDateLabel(provenance.at);
  if (provenance.kind === 'candidate') return 'со слов кандидата';
  if (provenance.kind === 'consultant') return date ? `консультант ${date}` : 'консультант';
  if (provenance.kind === 'footprint')
    return date ? `из цифрового следа, ${date}` : 'из цифрового следа';
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
  const date = importDateLabel(source.lastImportedAt);
  // One import source per profile: the second platform only connects and brings no facts.
  if (!source.factCount) return ['Подключено', date].filter(Boolean).join(' · ');
  const kept = source.keptFactCount ?? source.factCount;
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
 * «Обо мне» (B541): an accepted consultant edit or the candidate's own text
 * carries `aboutOrigin`; an imported text points at its fact. Drafts written
 * before B541 have neither — they are matched against the imported facts by
 * text, and any other text was written by the candidate.
 */
export function aboutProvenance(
  candidate: Pick<ResumeDraft['candidate'], 'about' | 'aboutMemoryId' | 'aboutOrigin'>,
  memory: readonly CandidateMemory[],
): FactProvenance | undefined {
  const text = candidate.about?.trim();
  if (!text) return undefined;
  if (candidate.aboutOrigin) return candidate.aboutOrigin;
  const linked = candidate.aboutMemoryId
    ? memory.find((entry) => entry.id === candidate.aboutMemoryId)?.provenance
    : undefined;
  if (linked) return linked;
  const match = memory.find((entry) => entry.statement.trim() === text)?.provenance;
  return match ?? { kind: 'candidate', at: '' };
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
