import type { ResumeExperience, TargetedResumeSlice } from './resumeTypes';
import { formatTargetedResumeAsAtsText } from './resumeExport';

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

export function estimateResumePages(targeted: TargetedResumeSlice): TargetedResumeVolume {
  const trimmed: TargetedResumeTrim[] = [];
  const afterExperience = trimIrrelevantExperience(targeted, trimmed);
  const afterBullets = trimIrrelevantBullets(afterExperience, trimmed);
  return withPageVolume(afterBullets.targeted, afterBullets.measurement, trimmed);
}

function trimIrrelevantExperience(
  targeted: TargetedResumeSlice,
  trimmed: TargetedResumeTrim[],
): PageEstimateState {
  let current = targeted;
  let measurement = measureAtsText(current);
  for (const role of oldestFirst(zeroMatchExperience(current))) {
    if (measurement.pages <= 2) break;
    current = replaceExperience(
      current,
      current.document.experience.filter((item) => item.id !== role.id),
    );
    trimmed.push({
      id: `experience:${role.id}`,
      kind: 'experience',
      label: experienceLabel(role),
      reason: 'В роли нет совпадений с требованиями вакансии; она удалена первой по давности.',
    });
    measurement = measureAtsText(current);
  }
  return { targeted: current, measurement };
}

function trimIrrelevantBullets(
  state: PageEstimateState,
  trimmed: TargetedResumeTrim[],
): PageEstimateState {
  let current = state.targeted;
  let measurement = state.measurement;
  for (const role of oldestFirst(current.document.experience)) {
    if (measurement.pages <= 2) break;
    while (measurement.pages > 2) {
      const currentRole = current.document.experience.find((item) => item.id === role.id);
      const bulletIndex = currentRole?.bullets.findIndex(
        (bullet) => !bulletMatches(bullet.value, current.requirements.map((item) => item.requirement)),
      );
      if (!currentRole || bulletIndex === undefined || bulletIndex < 0) break;
      const bullet = currentRole.bullets[bulletIndex];
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

function zeroMatchExperience(targeted: TargetedResumeSlice): readonly ResumeExperience[] {
  return targeted.document.experience.filter(
    (role) => !experienceMatches(role, targeted.requirements.map((item) => item.requirement)),
  );
}

function experienceMatches(role: ResumeExperience, requirements: readonly string[]): boolean {
  return [role.title?.value, role.employer?.value, role.location?.value, ...role.bullets.map((b) => b.value)]
    .filter((value): value is string => Boolean(value))
    .some((value) => bulletMatches(value, requirements));
}

function bulletMatches(bullet: string, requirements: readonly string[]): boolean {
  const normalizedBullet = normalizeText(bullet);
  if (!normalizedBullet) return false;
  return requirements.some((requirement) => {
    const normalizedRequirement = normalizeText(requirement);
    return normalizedRequirement.length > 0 &&
      ` ${normalizedBullet} `.includes(` ${normalizedRequirement} `);
  });
}

function normalizeText(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/gu, ' ');
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

function experienceLabel(role: ResumeExperience): string {
  const label = [role.title?.value, role.employer?.value].filter(Boolean).join(' — ');
  return label || 'Опыт работы без названия';
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
