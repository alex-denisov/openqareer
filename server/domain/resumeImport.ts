import type { ParsedResume } from '../../src/features/workspace/resumeParser';
import type { DOSSIER_DOMAINS } from './coach';
import type { ResumeDraft } from './resumeDraft';

/**
 * An imported resume is evidence, so it has to enter the dossier as evidence.
 *
 * Before this module the import wrote a draft whose `chronologyMemoryId`s
 * pointed at memories that were never created; `buildResumeStudioProjection`
 * then dropped every role, every school and every language, and Resume Studio
 * opened empty after a successful import (B148 §3b). Here one plan produces
 * both halves at once: the dossier memories **and** the draft that cites them,
 * so a claim in the document always has a resolvable source.
 *
 * Nothing is invented: every statement is text the candidate's own document
 * contained, and every value is clamped to what `resumeDraftSchema` accepts, so
 * an unusual CV can no longer turn the save into a silent 422.
 */

const MAX_STATEMENT = 1_000;
const MAX_LABEL = 300;
const MAX_LONG_TEXT = 10_000;
const MAX_DATE = 30;
const MAX_LINK = 500;
const MAX_EXPERIENCE = 50;
const MAX_BULLETS_PER_ROLE = 20;
const MAX_SKILLS = 100;
const MAX_EDUCATION = 30;
const MAX_COURSES = 50;
const MAX_TESTS = 50;
const MAX_RECOMMENDATIONS = 50;
const MAX_LANGUAGES = 30;
const MAX_LINKS = 20;

interface ResumeImportEvidence {
  readonly memoryId: string;
  readonly domain: (typeof DOSSIER_DOMAINS)[number];
  readonly statement: string;
}

export interface ResumeImportPlan {
  readonly evidence: readonly ResumeImportEvidence[];
  readonly draft: ResumeDraft;
}

export interface ResumeImportOptions {
  /** Namespaces every generated id so two imports never collide. */
  readonly idPrefix: string;
  /**
   * Marks the produced draft as v2 (B265). Absent for every existing hh/PDF/
   * text import, so those routes keep writing v1 drafts unchanged — only the
   * structured LinkedIn route passes `2` here.
   */
  readonly schemaVersion?: 2;
}

const MAX_CERTIFICATIONS = 50;
const MAX_PROJECTS = 50;
const MAX_ACHIEVEMENTS = 100;
const MAX_OPEN_TO_WORK_ROLES = 20;
const MAX_OPEN_TO_WORK_LOCATIONS = 20;
const MAX_OPEN_TO_WORK_WORKPLACE_TYPES = 3;
const MAX_SKILLS_PER_ROLE = 50;

/**
 * Whether the document said anything a career profile is built from. Stray
 * skill-shaped fragments alone are not a resume, and storing them would fill
 * the dossier with confirmed nonsense.
 */
export function carriesProfileSubstance(parsed: ParsedResume): boolean {
  return (
    parsed.experience.some((role) => hasWords(role.title) || hasWords(role.employer)) ||
    parsed.education.some((entry) => hasWords(entry.institution)) ||
    hasWords(parsed.about) ||
    hasWords(parsed.targetRole) ||
    hasWords(parsed.fullName) ||
    parsed.skills.filter(isPlausibleSkill).length >= 3
  );
}

export function planResumeImport(
  parsed: ParsedResume,
  options: ResumeImportOptions,
): ResumeImportPlan {
  const prefix = safePrefix(options.idPrefix);
  const evidence: ResumeImportEvidence[] = [];
  const experience = planExperience(parsed, prefix, evidence);
  const education = planEducation(parsed, prefix, evidence);
  const languages = planLanguages(parsed, prefix, evidence);
  const skills = planSkills(parsed, prefix, evidence);
  addProfileEvidence(parsed, prefix, evidence);
  const certifications = planCertifications(parsed, prefix, evidence);
  const projects = planProjects(parsed, prefix, evidence);
  const achievements = planAchievements(parsed, prefix, evidence);

  return {
    evidence,
    draft: {
      schemaVersion: options.schemaVersion,
      candidate: planCandidate(parsed),
      targetRole: label(parsed.targetRole),
      experience,
      skills,
      education,
      courses: planCourses(parsed, prefix),
      tests: planTests(parsed, prefix),
      recommendations: planRecommendations(parsed, prefix),
      languages,
      additional: planAdditional(parsed),
      ...(certifications.length ? { certifications } : {}),
      ...(projects.length ? { projects } : {}),
      ...(achievements.length ? { achievements } : {}),
      ...(planOpenToWork(parsed) ? { sourceSuggestions: { openToWork: planOpenToWork(parsed) } } : {}),
    },
  };
}

function planCandidate(parsed: ParsedResume): ResumeDraft['candidate'] {
  return {
    fullName: label(parsed.fullName),
    headline: label(parsed.headline),
    about: longText(parsed.about),
    contact: {
      email: email(parsed.contact.email),
      phone: clamp(parsed.contact.phone, 60),
      telegram: clamp(parsed.contact.telegram, 100),
      location: label(parsed.contact.location),
      links: parsed.contact.links
        .map((link) => clamp(link, MAX_LINK))
        .filter((link): link is string => Boolean(link))
        .slice(0, MAX_LINKS),
      linkedinUrl: clamp(parsed.contact.linkedinUrl, 2_000),
    },
  };
}

function planCertifications(
  parsed: ParsedResume,
  prefix: string,
  evidence: ResumeImportEvidence[],
): NonNullable<ResumeDraft['certifications']> {
  return (parsed.certifications ?? [])
    .filter((entry) => hasWords(entry.name))
    .slice(0, MAX_CERTIFICATIONS)
    .map((entry, index) => {
      const memoryId = `${prefix}-cert-${index + 1}`;
      evidence.push({
        memoryId,
        domain: 'other',
        statement: statement([entry.name, entry.issuer].filter(Boolean).join(' — ')),
      });
      return {
        id: memoryId,
        evidenceMemoryId: memoryId,
        name: clamp(entry.name, MAX_LABEL) ?? '',
        issuer: label(entry.issuer),
        issuedAt: clamp(entry.issuedAt, MAX_DATE),
        expiresAt: clamp(entry.expiresAt, MAX_DATE),
        credentialId: label(entry.credentialId),
        url: clamp(entry.url, 2_000),
      };
    });
}

function planProjects(
  parsed: ParsedResume,
  prefix: string,
  evidence: ResumeImportEvidence[],
): NonNullable<ResumeDraft['projects']> {
  return (parsed.projects ?? [])
    .filter((entry) => hasWords(entry.name))
    .slice(0, MAX_PROJECTS)
    .map((entry, index) => {
      const memoryId = `${prefix}-proj-${index + 1}`;
      evidence.push({
        memoryId,
        domain: 'other',
        statement: statement([entry.name, entry.description].filter(Boolean).join(' — ')),
      });
      return {
        id: memoryId,
        evidenceMemoryId: memoryId,
        name: clamp(entry.name, MAX_LABEL) ?? '',
        startDate: clamp(entry.startDate, MAX_DATE),
        endDate: clamp(entry.endDate, MAX_DATE),
        current: entry.current,
        description: descriptionText(entry.description),
        employer: label(entry.employer),
        url: clamp(entry.url, 2_000),
        skills: entry.skills?.map((skill) => clamp(skill, MAX_LABEL) ?? '').filter(Boolean),
      };
    });
}

function planAchievements(
  parsed: ParsedResume,
  prefix: string,
  evidence: ResumeImportEvidence[],
): NonNullable<ResumeDraft['achievements']> {
  return (parsed.achievements ?? [])
    .filter((entry) => hasWords(entry.title))
    .slice(0, MAX_ACHIEVEMENTS)
    .map((entry, index) => {
      const memoryId = `${prefix}-ach2-${index + 1}`;
      evidence.push({
        memoryId,
        domain: 'other',
        statement: statement([entry.title, entry.issuer].filter(Boolean).join(' — ')),
      });
      return {
        id: memoryId,
        evidenceMemoryId: memoryId,
        kind: entry.kind,
        title: clamp(entry.title, MAX_LABEL) ?? '',
        issuer: label(entry.issuer),
        role: label(entry.role),
        date: clamp(entry.date, MAX_DATE),
        endDate: clamp(entry.endDate, MAX_DATE),
        description: descriptionText(entry.description),
        url: clamp(entry.url, 2_000),
      };
    });
}

/**
 * Owner decision (tickets/B265 §3c): a native source's open-to-work signal is
 * only ever a proposal candidate reviews on screen — it never writes the
 * candidate's actual work preferences and never becomes a dossier fact.
 */
function planOpenToWork(
  parsed: ParsedResume,
): NonNullable<ResumeDraft['sourceSuggestions']>['openToWork'] {
  const openToWork = parsed.openToWork;
  if (!openToWork) return undefined;
  if (
    openToWork.roles.length === 0 &&
    openToWork.locations.length === 0 &&
    openToWork.workplaceTypes.length === 0
  ) {
    return undefined;
  }
  return {
    roles: openToWork.roles.map((role) => clamp(role, MAX_LABEL) ?? '').slice(0, MAX_OPEN_TO_WORK_ROLES),
    locations: openToWork.locations
      .map((location) => clamp(location, MAX_LABEL) ?? '')
      .slice(0, MAX_OPEN_TO_WORK_LOCATIONS),
    workplaceTypes: openToWork.workplaceTypes.slice(0, MAX_OPEN_TO_WORK_WORKPLACE_TYPES),
  };
}

function planCourses(parsed: ParsedResume, prefix: string): ResumeDraft['courses'] {
  return parsed.courses
    .filter((course) => course.name.trim().length > 0)
    .slice(0, MAX_COURSES)
    .map((course, index) => ({
      id: `${prefix}-course-${index + 1}`,
      name: clamp(course.name, MAX_LABEL) ?? '',
      institution: label(course.institution),
      year: clamp(course.year, MAX_DATE),
    }));
}

function planTests(parsed: ParsedResume, prefix: string): ResumeDraft['tests'] {
  return parsed.tests
    .filter((test) => test.name.trim().length > 0)
    .slice(0, MAX_TESTS)
    .map((test, index) => ({
      id: `${prefix}-test-${index + 1}`,
      name: clamp(test.name, MAX_LABEL) ?? '',
      provider: label(test.provider),
      score: label(test.score),
      year: clamp(test.year, MAX_DATE),
    }));
}

function planRecommendations(
  parsed: ParsedResume,
  prefix: string,
): ResumeDraft['recommendations'] {
  return parsed.recommendations
    .slice(0, MAX_RECOMMENDATIONS)
    .map((item, index) => ({
      id: `${prefix}-rec-${index + 1}`,
      recommender: label(item.recommender),
      organization: label(item.organization),
      position: label(item.position),
      text: item.text ? clamp(item.text, 5_000) : undefined,
      contact: label(item.contact),
      relationship: label(item.relationship),
      date: clamp(item.date, MAX_DATE),
    }));
}

function planAdditional(parsed: ParsedResume): ResumeDraft['additional'] {
  if (!parsed.additional) return undefined;
  return {
    citizenship: label(parsed.additional.citizenship),
    workSchedule: label(parsed.additional.workSchedule),
    relocation: label(parsed.additional.relocation),
    driversLicense: label(parsed.additional.driversLicense),
  };
}

function planRoleBullets(
  role: ParsedResume['experience'][number],
  prefix: string,
  index: number,
  evidence: ResumeImportEvidence[],
): string[] {
  const bulletMemoryIds: string[] = [];
  role.responsibilities.forEach((item, position) => {
    if (bulletMemoryIds.length >= MAX_BULLETS_PER_ROLE) return;
    const memoryId = `${prefix}-resp-${index + 1}-${position + 1}`;
    evidence.push({ memoryId, domain: 'responsibility', statement: statement(item) });
    bulletMemoryIds.push(memoryId);
  });
  role.achievements.forEach((item, position) => {
    if (bulletMemoryIds.length >= MAX_BULLETS_PER_ROLE) return;
    const memoryId = `${prefix}-ach-${index + 1}-${position + 1}`;
    evidence.push({ memoryId, domain: 'outcome', statement: statement(item) });
    bulletMemoryIds.push(memoryId);
  });
  return bulletMemoryIds;
}

function planExperience(
  parsed: ParsedResume,
  prefix: string,
  evidence: ResumeImportEvidence[],
): ResumeDraft['experience'] {
  return parsed.experience
    .filter((role) => role.title.trim().length > 0 || role.employer.trim().length > 0)
    .slice(0, MAX_EXPERIENCE)
    .map((role, index) => {
      const chronologyMemoryId = `${prefix}-exp-${index + 1}`;
      evidence.push({
        memoryId: chronologyMemoryId,
        domain: 'role-evidence',
        statement: statement(rolePeriodStatement(role)),
      });
      const bulletMemoryIds = planRoleBullets(role, prefix, index, evidence);
      return {
        id: `${prefix}-exp-${index + 1}`,
        chronologyMemoryId,
        title: label(role.title),
        employer: label(role.employer),
        location: label(role.location),
        startDate: clamp(role.startDate, MAX_DATE),
        endDate: role.current ? undefined : clamp(role.endDate, MAX_DATE),
        current: role.current,
        bulletMemoryIds,
        employmentType: label(role.employmentType),
        workplaceType: role.workplaceType,
        skills: role.skills
          ?.map((skill) => clamp(skill, MAX_LABEL) ?? '')
          .filter(Boolean)
          .slice(0, MAX_SKILLS_PER_ROLE),
        employerGroupKey: label(role.employerGroupKey),
      };
    });
}

function planEducation(
  parsed: ParsedResume,
  prefix: string,
  evidence: ResumeImportEvidence[],
): ResumeDraft['education'] {
  return parsed.education
    .filter((entry) => hasWords(entry.institution))
    .slice(0, MAX_EDUCATION)
    .map((entry, index) => {
      const memoryId = `${prefix}-edu-${index + 1}`;
      evidence.push({
        memoryId,
        domain: 'other',
        statement: statement(
          [entry.institution, entry.qualification, entry.endDate]
            .filter(Boolean)
            .join(', '),
        ),
      });
      return {
        id: memoryId,
        evidenceMemoryId: memoryId,
        institution: label(entry.institution),
        qualification: label(entry.qualification),
        startDate: clamp(entry.startDate, MAX_DATE),
        endDate: clamp(entry.endDate, MAX_DATE),
        description: descriptionText(entry.description),
      };
    });
}

function planLanguages(
  parsed: ParsedResume,
  prefix: string,
  evidence: ResumeImportEvidence[],
): ResumeDraft['languages'] {
  return parsed.languages
    .filter((entry) => hasWords(entry.name))
    .slice(0, MAX_LANGUAGES)
    .map((entry, index) => {
      const memoryId = `${prefix}-lang-${index + 1}`;
      evidence.push({
        memoryId,
        domain: 'other',
        statement: statement(
          entry.cefr ? `${entry.name} — ${entry.cefr}` : entry.name,
        ),
      });
      return {
        id: memoryId,
        evidenceMemoryId: memoryId,
        name: label(entry.name),
        cefr: entry.cefr,
      };
    });
}

/**
 * A section-less document makes the heuristic parser treat its whole body as
 * one "skill" or one "school". A label with fewer than two letters is
 * punctuation or a page number, never a competency or an institution, so it
 * must not become a confirmed dossier fact.
 */
function hasWords(value: string | undefined): boolean {
  return (value ?? '').replace(/[^\p{L}]/gu, '').length >= 2;
}

function isPlausibleSkill(value: string): boolean {
  return hasWords(value) && value.length <= 120;
}

function planSkills(
  parsed: ParsedResume,
  prefix: string,
  evidence: ResumeImportEvidence[],
): ResumeDraft['skills'] {
  return parsed.skills
    .map((skill) => skill.trim())
    .filter((skill) => skill.length > 0 && isPlausibleSkill(skill))
    .slice(0, MAX_SKILLS)
    .map((skill, index) => {
      const memoryId = `${prefix}-skill-${index + 1}`;
      evidence.push({ memoryId, domain: 'skill', statement: statement(skill) });
      return {
        id: memoryId,
        evidenceMemoryId: memoryId,
        name: clamp(skill, MAX_LABEL) ?? '',
      };
    });
}

/**
 * Headline, summary and location are what the profile surface reads, so they
 * become dossier facts too — otherwise «Профиль» stays empty after an import
 * that clearly contained them.
 */
function addProfileEvidence(
  parsed: ParsedResume,
  prefix: string,
  evidence: ResumeImportEvidence[],
): void {
  if (parsed.targetRole?.trim()) {
    evidence.push({
      memoryId: `${prefix}-headline`,
      domain: 'role-evidence',
      statement: statement(parsed.targetRole),
    });
  }
  if (parsed.about?.trim()) {
    evidence.push({
      memoryId: `${prefix}-about`,
      domain: 'other',
      statement: statement(parsed.about),
    });
  }
  if (parsed.contact.location?.trim()) {
    evidence.push({
      memoryId: `${prefix}-location`,
      domain: 'constraint',
      statement: statement(parsed.contact.location),
    });
  }
}

function rolePeriodStatement(role: ParsedResume['experience'][number]): string {
  const period = role.startDate
    ? ` (${role.startDate} — ${role.current ? 'наст. время' : (role.endDate ?? '?')})`
    : '';
  const employer = role.employer.trim() ? ` — ${role.employer.trim()}` : '';
  return `${role.title.trim() || 'Роль не названа'}${employer}${period}`;
}

/**
 * Every fact an import mints carries this prefix, and a fresh random tail per
 * import. The tail is what makes a second upload of the same document produce
 * new ids — which is why a later import has to be able to recognise the facts
 * an earlier one left behind (B162).
 */
export const IMPORT_MEMORY_ID_PREFIX = 'imp';

export function newImportMemoryIdPrefix(randomId: string): string {
  return `${IMPORT_MEMORY_ID_PREFIX}${randomId.replace(/-/gu, '').slice(0, 10)}`;
}

const IMPORTED_MEMORY_ID = new RegExp(
  `^${IMPORT_MEMORY_ID_PREFIX}[0-9a-f]{10}-`,
  'u',
);

export function isImportedMemoryId(memoryId: string): boolean {
  return IMPORTED_MEMORY_ID.test(memoryId);
}

function safePrefix(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_-]/gu, '').slice(0, 24);
  return /^[A-Za-z0-9]/u.test(sanitized) ? sanitized : `imp${sanitized}`;
}

function statement(value: string): string {
  const trimmed = value.trim().replace(/\s+/gu, ' ');
  return (trimmed || 'Без описания').slice(0, MAX_STATEMENT);
}

function clamp(value: string | undefined, max: number): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function label(value: string | undefined): string | undefined {
  return clamp(value, MAX_LABEL);
}

function longText(value: string | undefined): string | undefined {
  return clamp(value, MAX_LONG_TEXT);
}

/** Descriptions (education, project, achievement) cap at 5 000, per architecture §2. */
function descriptionText(value: string | undefined): string | undefined {
  return clamp(value, 5_000);
}

/**
 * `resumeDraftSchema` rejects anything that is not a real address, and the save
 * is all-or-nothing, so a mis-extracted address is dropped rather than allowed
 * to lose the whole import.
 */
function email(value: string | undefined): string | undefined {
  const trimmed = clamp(value, 320);
  if (!trimmed) return undefined;
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/u.test(trimmed) ? trimmed : undefined;
}
