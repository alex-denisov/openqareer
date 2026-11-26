import type { ResumeExperience, TargetedResumeSlice } from './resumeStudioTypes';
import { termAppears } from './requirementTerm';
import { formatTargetedResumeAsAtsText } from './resumeAtsText';

const PRINT_PAGE_WIDTH_MM = 210;
const PRINT_PAGE_HEIGHT_MM = 297;
const PRINT_MARGIN_MM = 18;
const PRINT_PADDING_PX = 32;
const PRINT_FONT_SIZE_PX = 14;
const PRINT_LINE_HEIGHT = 1.65;
const MONOSPACE_CHARACTER_WIDTH = 0.6;
const CSS_PIXELS_PER_MM = 96 / 25.4;

export interface TargetedResumeTrim {
  readonly id: string;
  readonly kind: 'experience' | 'bullet';
  readonly label: string;
  readonly reason: string;
}

export interface TargetedResumeVolume extends TargetedResumeSlice {
  readonly pages: number;
  readonly trimmed: readonly TargetedResumeTrim[];
  readonly warning: string | null;
}

interface PageMeasurement {
  readonly lines: number;
  readonly pages: number;
}

interface PageEstimateState {
  readonly targeted: TargetedResumeSlice;
  readonly measurement: PageMeasurement;
}

const CONTENT_COLUMNS = Math.floor(
  ((PRINT_PAGE_WIDTH_MM - PRINT_MARGIN_MM * 2) * CSS_PIXELS_PER_MM - PRINT_PADDING_PX * 2) /
    (PRINT_FONT_SIZE_PX * MONOSPACE_CHARACTER_WIDTH),
);

const PAGE_LINES = Math.floor(
  ((PRINT_PAGE_HEIGHT_MM - PRINT_MARGIN_MM * 2) * CSS_PIXELS_PER_MM - PRINT_PADDING_PX * 2) /
    (PRINT_FONT_SIZE_PX * PRINT_LINE_HEIGHT),
);

/** Bullets each place keeps when the version is fitted to two pages: a place never becomes a bare title (B713). */
export const MIN_BULLETS_PER_PLACE = 2;

/**
 * Fits the version to two pages by trimming bullets that match no requirement, oldest place first.
 * Places are never dropped: a gap in the work history is worse than a third page (B713).
 */
export function estimateResumePages(targeted: TargetedResumeSlice): TargetedResumeVolume {
  const trimmed: TargetedResumeTrim[] = [];
  const fitted = trimIrrelevantBullets(
    { targeted, measurement: measureAtsText(targeted) },
    trimmed,
  );
  return withPageVolume(fitted.targeted, fitted.measurement, trimmed);
}

function irrelevantBulletIndex(role: ResumeExperience | undefined, requirements: readonly string[]): number {
  if (!role || role.bullets.length <= MIN_BULLETS_PER_PLACE) return -1;
  return role.bullets.findIndex((bullet) => !bulletMatches(bullet.value, requirements));
}

function trimIrrelevantBullets(
  state: PageEstimateState,
  trimmed: TargetedResumeTrim[],
): PageEstimateState {
  let current = state.targeted;
  let measurement = state.measurement;
  const requirements = current.requirements.map((item) => item.requirement);
  for (const role of oldestFirst(current.document.experience)) {
    while (measurement.pages > 2) {
      const currentRole = current.document.experience.find((item) => item.id === role.id);
      const bulletIndex = irrelevantBulletIndex(currentRole, requirements);
      const bullet = currentRole?.bullets[bulletIndex];
      if (!bullet) break;
      current = replaceExperience(
        current,
        current.document.experience.map((item) =>
          item.id === role.id
            ? { ...item, bullets: item.bullets.filter((_, index) => index !== bulletIndex) }
            : item,
        ),
      );
      trimmed.push({
        id: `bullet:${role.id}:${bullet.memoryId}`,
        kind: 'bullet',
        label: bullet.value,
        reason: 'В пункте нет совпадений с требованиями вакансии.',
      });
      measurement = measureAtsText(current);
    }
  }
  return { targeted: current, measurement };
}

function withPageVolume(
  current: TargetedResumeSlice,
  measurement: PageMeasurement,
  trimmed: readonly TargetedResumeTrim[],
): TargetedResumeVolume {
  const warning =
    measurement.pages > 2
      ? `После отбора нерелевантных пунктов целевое резюме занимает ${measurement.pages} стр. Сократите его вручную.`
      : null;
  const document = {
    ...current.document,
    length: {
      lines: measurement.lines,
      pages: measurement.pages,
      linesPerPage: PAGE_LINES,
    },
  };
  return {
    ...current,
    document,
    estimatedPages: measurement.pages,
    pages: measurement.pages,
    trimmed,
    warning,
  };
}

function measureAtsText(targeted: TargetedResumeSlice): PageMeasurement {
  const text = formatTargetedResumeAsAtsText(targeted);
  const lines = text.split('\n').reduce((total, line) => total + wrappedLineCount(line), 0);
  return { lines, pages: Math.max(1, Math.ceil(lines / PAGE_LINES)) };
}

function wrappedLineCount(line: string): number {
  const characters = [...line].length;
  return Math.max(1, Math.ceil(characters / CONTENT_COLUMNS));
}

function bulletMatches(bullet: string, requirements: readonly string[]): boolean {
  return requirements.some((requirement) => termAppears(requirement, bullet));
}

function oldestFirst<T extends ResumeExperience>(roles: readonly T[]): T[] {
  return roles
    .map((role, index) => ({ role, index, start: startTime(role) }))
    .sort((left, right) => {
      if (left.start === null && right.start !== null) return 1;
      if (left.start !== null && right.start === null) return -1;
      return (left.start ?? 0) - (right.start ?? 0) || left.index - right.index;
    })
    .map(({ role }) => role);
}

function startTime(role: ResumeExperience): number | null {
  const raw = role.startDate?.value;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const time = Date.parse(raw);
  return Number.isFinite(time) ? time : null;
}

function replaceExperience(
  targeted: TargetedResumeSlice,
  experience: readonly ResumeExperience[],
): TargetedResumeSlice {
  return {
    ...targeted,
    document: { ...targeted.document, experience },
    detailedExperienceIds: experience.filter((role) => role.bullets.length > 0).map((role) => role.id),
    compressedExperienceIds: experience.filter((role) => role.bullets.length === 0).map((role) => role.id),
  };
}
