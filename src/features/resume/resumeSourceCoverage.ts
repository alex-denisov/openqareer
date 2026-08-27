import type { ImportedSourceSummary } from '../coach/coachApi';
import { PLATFORM_LABELS } from '../connections/platformLabels';
import type { ResumeDraft } from './resumeTypes';

/**
 * What the connected platform gave the document, and what it never held.
 *
 * The owner connected a real hh.ru account and read an empty Resume Studio:
 * «там нет моего имени, нет никаких данных из подключенного источника». Half of
 * that was a parser defect (B172 slices 1–2); the other half is that hh.ru
 * genuinely holds no work history for that account — it draws its own «add your
 * experience» card — and the product stayed silent, so an empty section read as
 * a product failure instead of an empty source (B172 slice 3).
 */
export interface ResumeSourceSection {
  readonly id: string;
  readonly label: string;
  /** How many entries the section holds; `null` where the section is one value. */
  readonly count: number | null;
}

export interface ResumeSourceCoverage {
  readonly filled: readonly ResumeSourceSection[];
  readonly empty: readonly ResumeSourceSection[];
}

export interface ImportedSource {
  readonly platform: ImportedSourceSummary['platform'];
  readonly label: string;
  readonly importedAt: string;
  readonly factCount: number;
}

/**
 * The document is the only honest witness here: it says what is in the resume
 * now. Attributing an empty section to the platform is safe because the section
 * can only be empty if neither the import nor the candidate has filled it.
 */
export function resumeSourceCoverage(draft: ResumeDraft): ResumeSourceCoverage {
  const contact = draft.candidate.contact;
  const sections: ResumeSourceSection[] = [
    single('full-name', 'Имя', Boolean(draft.candidate.fullName?.trim())),
    single(
      'contact',
      'Контакты',
      Boolean(
        contact?.email?.trim() ||
          contact?.phone?.trim() ||
          contact?.location?.trim() ||
          (contact?.links?.length ?? 0) > 0,
      ),
    ),
    single('target-role', 'Целевая роль', Boolean(draft.targetRole?.trim())),
    counted('experience', 'Опыт работы', draft.experience.length),
    counted('skills', 'Навыки', draft.skills?.length ?? 0),
    counted('education', 'Образование', draft.education.length),
    counted('languages', 'Языки', draft.languages.length),
    counted('courses', 'Курсы', draft.courses?.length ?? 0),
    counted('tests', 'Тесты', draft.tests?.length ?? 0),
    counted('recommendations', 'Рекомендации', draft.recommendations?.length ?? 0),
  ];
  return {
    filled: sections.filter((section) => section.count === null || section.count > 0),
    empty: sections.filter((section) => section.count === 0),
  };
}

/**
 * The platform whose import the candidate is looking at. With two connections
 * the later import is the one that shaped the document last, so it is the one
 * the block may speak for.
 */
export function importedSourceOf(
  sources: readonly ImportedSourceSummary[] | undefined,
): ImportedSource | undefined {
  const dated = (sources ?? []).filter((source) => Boolean(source.lastImportedAt));
  const [latest] = [...dated].sort((left, right) =>
    right.lastImportedAt.localeCompare(left.lastImportedAt),
  );
  if (!latest) return undefined;
  return {
    platform: latest.platform,
    label: PLATFORM_LABELS[latest.platform],
    importedAt: latest.lastImportedAt,
    factCount: latest.factCount,
  };
}

function single(id: string, label: string, present: boolean): ResumeSourceSection {
  return { id, label, count: present ? null : 0 };
}

function counted(id: string, label: string, count: number): ResumeSourceSection {
  return { id, label, count };
}
