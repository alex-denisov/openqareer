/* eslint-disable max-lines */
import type {
  CefrLevel,
  ResumeCandidateInput,
  ResumeDraft,
  ResumeEducationInput,
  ResumeExperienceInput,
  ResumeLanguageInput,
} from './resumeDraft';
import { isResumeEvidenceEligible } from './resumeEvidenceEligibility';

export type { CefrLevel, ResumeDraft } from './resumeDraft';

export type ResumeMemoryStatus = 'proposed' | 'confirmed' | 'corrected';
export type ResumeMemoryKind =
  | 'fact'
  | 'preference'
  | 'hypothesis'
  | 'open-question';

export interface ResumeEvidence {
  readonly id: string;
  readonly kind: ResumeMemoryKind;
  readonly status: ResumeMemoryStatus;
  readonly statement: string;
  readonly sourceMessageIds: readonly string[];
  readonly sensitive: boolean;
}

export interface ResumeStudioInput extends ResumeDraft {
  readonly evidence: readonly ResumeEvidence[];
}

export type ResumeReviewFlag =
  'quantitative-claim-needs-substantiation';

export interface ResumeAssertion<T extends string | boolean = string> {
  readonly value: T;
  readonly memoryId: string;
  readonly sourceMessageIds: readonly string[];
  readonly reviewFlags: readonly ResumeReviewFlag[];
}

export interface ResumeExperience {
  readonly id: string;
  readonly title: ResumeAssertion | null;
  readonly employer: ResumeAssertion | null;
  readonly location: ResumeAssertion | null;
  readonly startDate: ResumeAssertion | null;
  readonly endDate: ResumeAssertion | null;
  readonly current: ResumeAssertion<boolean>;
  readonly bullets: readonly ResumeAssertion[];
}

export interface ResumeEducation {
  readonly id: string;
  readonly institution: ResumeAssertion | null;
  readonly qualification: ResumeAssertion | null;
  readonly startDate: ResumeAssertion | null;
  readonly endDate: ResumeAssertion | null;
}

export interface ResumeLanguage {
  readonly id: string;
  readonly name: ResumeAssertion | null;
  readonly cefr: ResumeAssertion<CefrLevel> | null;
}

export type ResumeUnknownCode =
  | 'missing-full-name'
  | 'missing-contact'
  | 'missing-target-role'
  | 'missing-role-chronology'
  | 'missing-role-title'
  | 'missing-employer'
  | 'missing-role-start-date'
  | 'missing-role-end-date'
  | 'missing-role-claims'
  | 'missing-education'
  | 'missing-education-details'
  | 'missing-language-name'
  | 'missing-language-level'
  | 'chronology-conflict'
  | 'invalid-chronology-date'
  | 'ineligible-evidence'
  | 'germany-bullet-count'
  | 'germany-length-exceeds-two-pages';

export interface ResumeUnknown {
  readonly code: ResumeUnknownCode;
  readonly message: string;
  readonly scope: 'both' | 'DE';
  readonly blocking: boolean;
  readonly entryId?: string;
  readonly memoryId?: string;
}

export interface ResumeConventions {
  readonly country: 'DE' | null;
  readonly packVersion: 'DE-CV-2026.1' | null;
  readonly reverseChronological: boolean;
  readonly maxPages: 2 | null;
  readonly recommendedBulletsPerRole: { readonly min: 3; readonly max: 5 } | null;
  readonly photo: 'omitted';
  readonly discriminatoryPii: 'omitted';
}

export interface ResumeContact {
  readonly fullName: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly telegram?: string | null;
  readonly location: string | null;
  readonly links: readonly string[];
}

export interface ResumeLengthEstimate {
  readonly lines: number;
  readonly pages: number;
  readonly linesPerPage: number;
}

export interface ResumeDocument {
  readonly kind: 'master' | 'country-role';
  readonly targetRole: string | null;
  readonly contact: ResumeContact;
  readonly about?: string | null;
  readonly photoUrl?: string | null;
  readonly experience: readonly ResumeExperience[];
  readonly skills?: readonly import('./resumeDraft').ResumeSkillInput[];
  readonly education: readonly ResumeEducation[];
  readonly courses?: readonly import('./resumeDraft').ResumeCourseInput[];
  readonly tests?: readonly import('./resumeDraft').ResumeTestInput[];
  readonly recommendations?: readonly import('./resumeDraft').ResumeRecommendationInput[];
  readonly languages: readonly ResumeLanguage[];
  readonly additional?: import('./resumeDraft').ResumeAdditionalInput | null;
  readonly unknowns: readonly ResumeUnknown[];
  readonly conventions: ResumeConventions;
  readonly length: ResumeLengthEstimate;
}

export interface ResumeEvidenceSnapshot {
  readonly memoryId: string;
  readonly statement: string;
  readonly sourceMessageIds: readonly string[];
}

export interface ResumeStudioProjection {
  readonly master: ResumeDocument;
  readonly germanyVariant: ResumeDocument;
  readonly evidenceSnapshot: readonly ResumeEvidenceSnapshot[];
  readonly excludedEvidenceIds: readonly string[];
}

export type StaleEvidenceReason =
  | 'missing'
  | 'duplicate-current-evidence'
  | 'no-longer-confirmed'
  | 'became-sensitive'
  | 'became-non-factual'
  | 'statement-changed'
  | 'provenance-changed';

export interface ResumeEvidenceFreshness {
  readonly valid: boolean;
  readonly stale: ReadonlyArray<{
    readonly memoryId: string;
    readonly reasons: readonly StaleEvidenceReason[];
  }>;
}

interface NormalizedEvidence {
  readonly id: string;
  readonly statement: string;
  readonly sourceMessageIds: readonly string[];
  readonly kind: ResumeMemoryKind;
  readonly status: ResumeMemoryStatus;
  readonly sensitive: boolean;
}

interface EvidenceCatalog {
  readonly eligible: ReadonlyMap<string, NormalizedEvidence>;
  readonly duplicateIds: ReadonlySet<string>;
}

interface ProjectionContext {
  readonly catalog: EvidenceCatalog;
  readonly usedEvidenceIds: Set<string>;
  readonly excludedEvidenceIds: Set<string>;
  readonly unknowns: ResumeUnknown[];
}

const CEFR_LEVELS = new Set<CefrLevel>(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);

const GERMANY_MAX_PAGES = 2;
const LINES_PER_PAGE = 45;
const CHARACTERS_PER_LINE = 90;
const HEADER_BASE_LINES = 2;
const ENTRY_HEADER_LINES = 2;
const SECTION_HEADING_LINES = 1;

const MASTER_CONVENTIONS: ResumeConventions = {
  country: null,
  packVersion: null,
  reverseChronological: false,
  maxPages: null,
  recommendedBulletsPerRole: null,
  photo: 'omitted',
  discriminatoryPii: 'omitted',
};

const GERMANY_CONVENTIONS: ResumeConventions = {
  country: 'DE',
  packVersion: 'DE-CV-2026.1',
  reverseChronological: true,
  maxPages: 2,
  recommendedBulletsPerRole: { min: 3, max: 5 },
  photo: 'omitted',
  discriminatoryPii: 'omitted',
};

// eslint-disable-next-line max-lines-per-function
export function buildResumeStudioProjection(
  input: ResumeStudioInput,
): ResumeStudioProjection {
  const context: ProjectionContext = {
    catalog: buildEvidenceCatalog(input.evidence),
    usedEvidenceIds: new Set<string>(),
    excludedEvidenceIds: new Set<string>(),
    unknowns: identityUnknowns(input.candidate),
  };
  const contact = projectContact(input.candidate);
  const experience = projectExperience(input.experience, context);
  const education = projectEducation(input.education, context);
  const languages = projectLanguages(input.languages, context);
  const skills = input.skills ?? [];
  const courses = input.courses ?? [];
  const tests = input.tests ?? [];
  const recommendations = input.recommendations ?? [];
  const about = clean(input.candidate.about);
  const photoUrl = clean(input.candidate.photoUrl);
  const additional = input.additional ?? null;
  addSectionUnknowns(experience, education, languages, context.unknowns);
  const masterUnknowns = [...context.unknowns];
  return {
    master: document(
      'master',
      null,
      contact,
      about,
      photoUrl,
      experience,
      skills,
      education,
      courses,
      tests,
      recommendations,
      languages,
      additional,
      masterUnknowns,
      estimateLength(contact, experience, education, languages),
    ),
    germanyVariant: germanyDocument(input.targetRole, contact, {
      about,
      photoUrl,
      experience,
      skills,
      education,
      courses,
      tests,
      recommendations,
      languages,
      additional,
      commonUnknowns: masterUnknowns,
    }),
    evidenceSnapshot: evidenceSnapshot(context),
    excludedEvidenceIds: [...context.excludedEvidenceIds].sort(),
  };
}

interface GermanySections {
  readonly about?: string | null;
  readonly photoUrl?: string | null;
  readonly experience: readonly ResumeExperience[];
  readonly skills?: readonly import('./resumeDraft').ResumeSkillInput[];
  readonly education: readonly ResumeEducation[];
  readonly courses?: readonly import('./resumeDraft').ResumeCourseInput[];
  readonly tests?: readonly import('./resumeDraft').ResumeTestInput[];
  readonly recommendations?: readonly import('./resumeDraft').ResumeRecommendationInput[];
  readonly languages: readonly ResumeLanguage[];
  readonly additional?: import('./resumeDraft').ResumeAdditionalInput | null;
  readonly commonUnknowns: readonly ResumeUnknown[];
}

function germanyDocument(
  targetRole: string | undefined,
  contact: ResumeContact,
  sections: GermanySections,
): ResumeDocument {
  const experience = [...sections.experience].sort(
    compareExperienceReverseChronologically,
  );
  const length = estimateLength(
    contact,
    experience,
    sections.education,
    sections.languages,
  );
  return document(
    'country-role',
    clean(targetRole),
    contact,
    sections.about,
    sections.photoUrl,
    experience,
    sections.skills,
    sections.education,
    sections.courses,
    sections.tests,
    sections.recommendations,
    sections.languages,
    sections.additional,
    germanyVariantUnknowns(
      targetRole,
      experience,
      sections.commonUnknowns,
      length,
    ),
    length,
  );
}

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

function buildEvidenceCatalog(evidence: readonly ResumeEvidence[]): EvidenceCatalog {
  const grouped = groupCurrentEvidence(evidence);
  const eligible = new Map<string, NormalizedEvidence>();
  const duplicateIds = new Set<string>();
  for (const [id, items] of grouped) {
    if (items.length !== 1) {
      duplicateIds.add(id);
      continue;
    }
    const normalized = normalizeEvidence(items[0]!);
    if (isEligible(normalized)) eligible.set(id, normalized);
  }
  return { eligible, duplicateIds };
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

function isEligible(evidence: NormalizedEvidence): boolean {
  return isResumeEvidenceEligible(evidence);
}

function resolveEvidence(
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
    message:
      'Факт отсутствует, не подтверждён, помечен чувствительным или не имеет источника.',
    scope: 'both',
    blocking: true,
    entryId,
    memoryId: id || undefined,
  });
  return null;
}

function projectContact(candidate: ResumeCandidateInput): ResumeContact {
  return {
    fullName: clean(candidate.fullName),
    email: clean(candidate.contact?.email),
    phone: clean(candidate.contact?.phone),
    telegram: clean(candidate.contact?.telegram),
    location: clean(candidate.contact?.location),
    links: (candidate.contact?.links ?? []).flatMap((link) => {
      const normalized = clean(link);
      return normalized ? [normalized] : [];
    }),
  };
}

function identityUnknowns(candidate: ResumeCandidateInput): ResumeUnknown[] {
  const unknowns: ResumeUnknown[] = [];
  if (!clean(candidate.fullName)) {
    unknowns.push(unknown('missing-full-name', 'Укажите имя для заголовка резюме.'));
  }
  if (!clean(candidate.contact?.email) && !clean(candidate.contact?.phone)) {
    unknowns.push(
      unknown('missing-contact', 'Укажите email или телефон для связи.'),
    );
  }
  return unknowns;
}

function projectExperience(
  input: readonly ResumeExperienceInput[],
  context: ProjectionContext,
): ResumeExperience[] {
  return input.flatMap((role) => {
    const chronology = resolveEvidence(role.chronologyMemoryId, context, role.id);
    if (!chronology) return [];
    addRoleUnknowns(role, context.unknowns);
    const bullets = role.bulletMemoryIds.flatMap((memoryId) => {
      const evidence = resolveEvidence(memoryId, context, role.id);
      return evidence ? [claimAssertion(evidence)] : [];
    });
    if (bullets.length === 0) {
      context.unknowns.push(
        unknown(
          'missing-role-claims',
          'Добавьте подтверждённый результат или ответственность для роли.',
          role.id,
        ),
      );
    }
    return [experienceFrom(role, chronology, bullets)];
  });
}

function experienceFrom(
  role: ResumeExperienceInput,
  evidence: NormalizedEvidence,
  bullets: readonly ResumeAssertion[],
): ResumeExperience {
  return {
    id: role.id,
    title: optionalAssertion(role.title, evidence),
    employer: optionalAssertion(role.employer, evidence),
    location: optionalAssertion(role.location, evidence),
    startDate: optionalAssertion(role.startDate, evidence),
    endDate: role.current ? null : optionalAssertion(role.endDate, evidence),
    current: assertion(role.current, evidence),
    bullets,
  };
}

function addRoleUnknowns(
  role: ResumeExperienceInput,
  unknowns: ResumeUnknown[],
): void {
  if (!clean(role.title)) {
    unknowns.push(unknown('missing-role-title', 'Укажите название роли.', role.id));
  }
  if (!clean(role.employer)) {
    unknowns.push(unknown('missing-employer', 'Укажите работодателя.', role.id));
  }
  if (!clean(role.startDate)) {
    unknowns.push(
      unknown('missing-role-start-date', 'Укажите дату начала роли.', role.id),
    );
  }
  if (!role.current && !clean(role.endDate)) {
    unknowns.push(
      unknown('missing-role-end-date', 'Укажите дату окончания роли.', role.id),
    );
  }
  addChronologyIssues(role, unknowns);
}

function addChronologyIssues(
  role: ResumeExperienceInput,
  unknowns: ResumeUnknown[],
): void {
  const start = clean(role.startDate);
  const end = clean(role.endDate);
  for (const value of [start, end]) {
    if (value && !isResumeDate(value)) {
      unknowns.push(
        unknown('invalid-chronology-date', `Проверьте дату «${value}».`, role.id),
      );
    }
  }
  const startRank = dateRank(start);
  const endRank = dateRank(end);
  if (
    (role.current && end) ||
    (!role.current && startRank !== null && endRank !== null && startRank > endRank)
  ) {
    unknowns.push(
      unknown(
        'chronology-conflict',
        'Даты роли противоречат друг другу и требуют подтверждения.',
        role.id,
      ),
    );
  }
}

function projectEducation(
  input: readonly ResumeEducationInput[],
  context: ProjectionContext,
): ResumeEducation[] {
  return input.flatMap((item) => {
    const evidence = resolveEvidence(item.evidenceMemoryId, context, item.id);
    if (!evidence) return [];
    if (!clean(item.institution) || !clean(item.qualification)) {
      context.unknowns.push(
        unknown(
          'missing-education-details',
          'Уточните учебное заведение и квалификацию.',
          item.id,
        ),
      );
    }
    return [
      {
        id: item.id,
        institution: optionalAssertion(item.institution, evidence),
        qualification: optionalAssertion(item.qualification, evidence),
        startDate: optionalAssertion(item.startDate, evidence),
        endDate: optionalAssertion(item.endDate, evidence),
      },
    ];
  });
}

function projectLanguages(
  input: readonly ResumeLanguageInput[],
  context: ProjectionContext,
): ResumeLanguage[] {
  return input.flatMap((item) => {
    const evidence = resolveEvidence(item.evidenceMemoryId, context, item.id);
    if (!evidence) return [];
    if (!clean(item.name)) {
      context.unknowns.push(
        unknown('missing-language-name', 'Укажите язык.', item.id),
      );
    }
    const cefr = validCefr(item.cefr);
    if (!cefr) {
      context.unknowns.push(
        unknown(
          'missing-language-level',
          'Укажите подтверждённый уровень CEFR от A1 до C2.',
          item.id,
        ),
      );
    }
    return [
      {
        id: item.id,
        name: optionalAssertion(item.name, evidence),
        cefr: cefr ? assertion(cefr, evidence) : null,
      },
    ];
  });
}

function addSectionUnknowns(
  experience: readonly ResumeExperience[],
  education: readonly ResumeEducation[],
  languages: readonly ResumeLanguage[],
  unknowns: ResumeUnknown[],
): void {
  if (experience.length === 0) {
    unknowns.push(
      unknown(
        'missing-role-chronology',
        'Добавьте хотя бы одну подтверждённую роль с датами.',
      ),
    );
  }
  if (education.length === 0) {
    unknowns.push(
      unknown('missing-education', 'Добавьте подтверждённое образование.'),
    );
  }
  if (languages.length === 0) {
    unknowns.push(
      unknown(
        'missing-language-level',
        'Добавьте язык и подтверждённый уровень CEFR.',
      ),
    );
  }
}

function germanyVariantUnknowns(
  targetRole: string | undefined,
  experience: readonly ResumeExperience[],
  common: readonly ResumeUnknown[],
  length: ResumeLengthEstimate,
): ResumeUnknown[] {
  const unknowns = [...common];
  if (!clean(targetRole)) {
    unknowns.push({
      ...unknown('missing-target-role', 'Укажите целевую роль для версии DE.'),
      scope: 'DE',
    });
  }
  for (const role of experience) {
    if (role.bullets.length < 3 || role.bullets.length > 5) {
      unknowns.push({
        ...unknown(
          'germany-bullet-count',
          'Для версии DE проверьте диапазон от трёх до пяти пунктов на роль.',
          role.id,
          false,
        ),
        scope: 'DE',
      });
    }
  }
  if (length.pages > GERMANY_MAX_PAGES) {
    unknowns.push({
      ...unknown(
        'germany-length-exceeds-two-pages',
        `Версия DE занимает примерно ${length.pages} страницы при пределе ${GERMANY_MAX_PAGES}: сократите формулировки, не удаляя подтверждённые факты.`,
      ),
      scope: 'DE',
    });
  }
  return unknowns;
}

function document(
  kind: ResumeDocument['kind'],
  targetRole: string | null,
  contact: ResumeContact,
  about: string | null | undefined,
  photoUrl: string | null | undefined,
  experience: readonly ResumeExperience[],
  skills: readonly import('./resumeDraft').ResumeSkillInput[] | undefined,
  education: readonly ResumeEducation[],
  courses: readonly import('./resumeDraft').ResumeCourseInput[] | undefined,
  tests: readonly import('./resumeDraft').ResumeTestInput[] | undefined,
  recommendations: readonly import('./resumeDraft').ResumeRecommendationInput[] | undefined,
  languages: readonly ResumeLanguage[],
  additional: import('./resumeDraft').ResumeAdditionalInput | null | undefined,
  unknowns: readonly ResumeUnknown[],
  length: ResumeLengthEstimate,
): ResumeDocument {
  return {
    kind,
    targetRole,
    contact,
    about: about ?? null,
    photoUrl: photoUrl ?? null,
    experience,
    skills: skills ?? [],
    education,
    courses: courses ?? [],
    tests: tests ?? [],
    recommendations: recommendations ?? [],
    languages,
    additional: additional ?? null,
    unknowns,
    conventions: kind === 'master' ? MASTER_CONVENTIONS : GERMANY_CONVENTIONS,
    length,
  };
}

/**
 * Deterministic tabular-layout estimate: one line per header row, per entry row
 * and per wrapped bullet line. It never truncates a document — an over-long
 * Germany variant is reported as an unknown so the candidate shortens wording
 * instead of the product dropping confirmed evidence.
 */
function estimateLength(
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

function assertion<T extends string | boolean>(
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

function optionalAssertion(
  value: string | undefined,
  evidence: NormalizedEvidence,
): ResumeAssertion | null {
  const normalized = clean(value);
  return normalized ? assertion(normalized, evidence) : null;
}

function claimAssertion(evidence: NormalizedEvidence): ResumeAssertion {
  return assertion(
    evidence.statement,
    evidence,
    containsQuantity(evidence.statement)
      ? ['quantitative-claim-needs-substantiation']
      : [],
  );
}

function evidenceSnapshot(context: ProjectionContext): ResumeEvidenceSnapshot[] {
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

function compareExperienceReverseChronologically(
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

function unknown(
  code: ResumeUnknownCode,
  message: string,
  entryId?: string,
  blocking = true,
): ResumeUnknown {
  return { code, message, scope: 'both', blocking, entryId };
}

function validCefr(value: CefrLevel | undefined): CefrLevel | null {
  return typeof value === 'string' && CEFR_LEVELS.has(value) ? value : null;
}

function clean(value: string | undefined): string | null {
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

function isResumeDate(value: string): boolean {
  return /^\d{4}-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?$/u.test(value);
}

function dateRank(value: string | null | undefined): number | null {
  if (!value || !isResumeDate(value)) return null;
  const [year, month] = value.split('-').map(Number);
  return year! * 12 + month!;
}
