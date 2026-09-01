import type {
  CefrLevel,
} from './resumeDraft';
import {
  resumeEvidenceIneligibilityReason,
  type ResumeEvidenceIneligibilityReason,
} from './resumeEvidenceEligibility';
import type {
  EvidenceCatalog,
  NormalizedEvidence,
  ProjectionContext,
  ResumeAssertion,
  ResumeEducation,
  ResumeEvidence,
  ResumeExperience,
  ResumeLanguage,
  ResumeContact,
  ResumeLengthEstimate,
  ResumeReviewFlag,
  ResumeUnknown,
  ResumeUnknownCode,
  StaleEvidenceReason,
  ResumeEvidenceFreshness,
  ResumeEvidenceSnapshot,
} from './resumeStudioTypes';

export const GERMANY_MAX_PAGES = 2;
const LINES_PER_PAGE = 45;
const CHARACTERS_PER_LINE = 90;
const HEADER_BASE_LINES = 2;
const ENTRY_HEADER_LINES = 2;
const SECTION_HEADING_LINES = 1;

const CEFR_LEVELS = new Set<CefrLevel>(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);

/**
 * Compares the evidence the candidate approved when the resume was saved with
 * the dossier as it stands now, so a revoked or edited fact is reported instead
 * of silently surviving inside an already generated document.
 */
export function validateResumeEvidenceFreshness(
  approvedSnapshot: readonly ResumeEvidenceSnapshot[],
  currentEvidence: readonly ResumeEvidence[],
): ResumeEvidenceFreshness {
  const currentById = groupCurrentEvidence(currentEvidence);
  const stale = approvedSnapshot.flatMap((snapshot) => {
    const current = currentById.get(snapshot.memoryId) ?? [];
    if (current.length === 0) {
      return [{ memoryId: snapshot.memoryId, reasons: ['missing' as const] }];
    }
    if (current.length > 1) {
      return [
        {
          memoryId: snapshot.memoryId,
          reasons: ['duplicate-current-evidence' as const],
        },
      ];
    }
    const reasons = freshnessReasons(snapshot, normalizeEvidence(current[0]!));
    return reasons.length > 0 ? [{ memoryId: snapshot.memoryId, reasons }] : [];
  });
  return { valid: stale.length === 0, stale };
}

export function buildEvidenceCatalog(evidence: readonly ResumeEvidence[]): EvidenceCatalog {
  const grouped = groupCurrentEvidence(evidence);
  const eligible = new Map<string, NormalizedEvidence>();
  const duplicateIds = new Set<string>();
  const ineligible = new Map<string, ResumeEvidenceIneligibilityReason>();
  for (const [id, items] of grouped) {
    if (items.length !== 1) {
      duplicateIds.add(id);
      continue;
    }
    const normalized = normalizeEvidence(items[0]!);
    const reason = resumeEvidenceIneligibilityReason(normalized);
    if (reason === null) eligible.set(id, normalized);
    else ineligible.set(id, reason);
  }
  return { eligible, duplicateIds, ineligible };
}

function groupCurrentEvidence(
  evidence: readonly ResumeEvidence[],
): Map<string, ResumeEvidence[]> {
  const grouped = new Map<string, ResumeEvidence[]>();
  for (const item of evidence) {
    const id = clean(item.id);
    if (!id) continue;
    grouped.set(id, [...(grouped.get(id) ?? []), item]);
  }
  return grouped;
}

function normalizeEvidence(evidence: ResumeEvidence): NormalizedEvidence {
  return {
    id: clean(evidence.id) ?? '',
    statement: clean(evidence.statement) ?? '',
    sourceMessageIds: normalizedSourceIds(evidence.sourceMessageIds),
    kind: evidence.kind,
    status: evidence.status,
    sensitive: evidence.sensitive,
  };
}

export function resolveEvidence(
  memoryId: string,
  context: ProjectionContext,
  entryId: string,
): NormalizedEvidence | null {
  const id = clean(memoryId) ?? '';
  const resolved = context.catalog.eligible.get(id);
  if (resolved && !context.catalog.duplicateIds.has(id)) {
    context.usedEvidenceIds.add(id);
    return resolved;
  }
  if (id) context.excludedEvidenceIds.add(id);
  context.unknowns.push({
    code: 'ineligible-evidence',
    message: ineligibleEvidenceMessage(context.catalog.ineligible.get(id)),
    scope: 'both',
    blocking: true,
    entryId,
    memoryId: id || undefined,
  });
  return null;
}

function ineligibleEvidenceMessage(
  reason: ResumeEvidenceIneligibilityReason | undefined,
): string {
  switch (reason) {
    case 'not-confirmed':
      return 'Факт ещё не подтверждён кандидатом — подтвердите его на «Главной».';
    case 'sensitive':
      return 'Факт помечен чувствительным и не попадает в документ.';
    case 'no-provenance':
      return 'У факта нет источника, на который мог бы сослаться документ.';
    case 'not-a-fact':
      return 'Это открытый вопрос, а не факт: документ не может на него сослаться.';
    case 'empty':
      return 'Факт пуст и не может стать утверждением в документе.';
    default:
      return 'Факт отсутствует в досье или дублируется — документ не может на него сослаться.';
  }
}

/**
 * Deterministic tabular-layout estimate: one line per header row, per entry row
 * and per wrapped bullet line. It never truncates a document — an over-long
 * Germany variant is reported as an unknown so the candidate shortens wording
 * instead of the product dropping confirmed evidence.
 */
export function estimateLength(
  contact: ResumeContact,
  experience: readonly ResumeExperience[],
  education: readonly ResumeEducation[],
  languages: readonly ResumeLanguage[],
): ResumeLengthEstimate {
  const header =
    HEADER_BASE_LINES +
    [contact.fullName, contact.email, contact.phone, contact.location].filter(
      (value) => value !== null,
    ).length +
    contact.links.length;
  const roles = experience.reduce(
    (total, role) =>
      total +
      ENTRY_HEADER_LINES +
      role.bullets.reduce((lines, bullet) => lines + wrappedLines(bullet.value), 0),
    0,
  );
  const lines =
    header +
    roles +
    education.length * ENTRY_HEADER_LINES +
    languages.length +
    SECTION_HEADING_LINES * 3;
  return {
    lines,
    pages: Math.max(1, Math.ceil(lines / LINES_PER_PAGE)),
    linesPerPage: LINES_PER_PAGE,
  };
}

function wrappedLines(value: string): number {
  return Math.max(1, Math.ceil(value.length / CHARACTERS_PER_LINE));
}

export function assertion<T extends string | boolean>(
  value: T,
  evidence: NormalizedEvidence,
  reviewFlags: readonly ResumeReviewFlag[] = [],
): ResumeAssertion<T> {
  return {
    value,
    memoryId: evidence.id,
    sourceMessageIds: [...evidence.sourceMessageIds],
    reviewFlags,
  };
}

export function optionalAssertion(
  value: string | undefined,
  evidence: NormalizedEvidence,
): ResumeAssertion | null {
  const normalized = clean(value);
  return normalized ? assertion(normalized, evidence) : null;
}

export function claimAssertion(evidence: NormalizedEvidence): ResumeAssertion {
  return assertion(
    evidence.statement,
    evidence,
    containsQuantity(evidence.statement)
      ? ['quantitative-claim-needs-substantiation']
      : [],
  );
}

export function evidenceSnapshot(context: ProjectionContext): ResumeEvidenceSnapshot[] {
  return [...context.usedEvidenceIds]
    .sort()
    .flatMap((id) => {
      const evidence = context.catalog.eligible.get(id);
      return evidence
        ? [
            {
              memoryId: evidence.id,
              statement: evidence.statement,
              sourceMessageIds: [...evidence.sourceMessageIds],
            },
          ]
        : [];
    });
}

function freshnessReasons(
  snapshot: ResumeEvidenceSnapshot,
  current: NormalizedEvidence,
): StaleEvidenceReason[] {
  const reasons: StaleEvidenceReason[] = [];
  if (current.status !== 'confirmed' && current.status !== 'corrected') {
    reasons.push('no-longer-confirmed');
  }
  if (current.sensitive) reasons.push('became-sensitive');
  if (current.kind !== 'fact') reasons.push('became-non-factual');
  if (current.statement !== snapshot.statement) reasons.push('statement-changed');
  if (!sameStrings(current.sourceMessageIds, snapshot.sourceMessageIds)) {
    reasons.push('provenance-changed');
  }
  return reasons;
}

export function compareExperienceReverseChronologically(
  left: ResumeExperience,
  right: ResumeExperience,
): number {
  const endDifference = experienceEndRank(right) - experienceEndRank(left);
  if (endDifference !== 0) return endDifference;
  const startDifference =
    (dateRank(right.startDate?.value) ?? -1) -
    (dateRank(left.startDate?.value) ?? -1);
  return startDifference || left.id.localeCompare(right.id);
}

function experienceEndRank(role: ResumeExperience): number {
  if (role.current.value) return Number.MAX_SAFE_INTEGER;
  return dateRank(role.endDate?.value) ?? dateRank(role.startDate?.value) ?? -1;
}

export function unknown(
  code: ResumeUnknownCode,
  message: string,
  entryId?: string,
  blocking = true,
): ResumeUnknown {
  return { code, message, scope: 'both', blocking, entryId };
}

export function validCefr(value: CefrLevel | undefined): CefrLevel | null {
  return typeof value === 'string' && CEFR_LEVELS.has(value) ? value : null;
}

export function clean(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizedSourceIds(values: readonly string[]): string[] {
  return [...new Set(values.flatMap((value) => (clean(value) ? [value.trim()] : [])))].sort();
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((value, index) => value === right[index])
  );
}

function containsQuantity(value: string): boolean {
  return /(?:\d|[$€£])/u.test(value);
}

export function isResumeDate(value: string): boolean {
  return /^\d{4}-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?$/u.test(value);
}

export function dateRank(value: string | null | undefined): number | null {
  if (!value || !isResumeDate(value)) return null;
  const [year, month] = value.split('-').map(Number);
  return year! * 12 + month!;
}
