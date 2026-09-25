import type { ParsedResume } from '../../src/features/workspace/resumeParser';
import type { LinkedInProfileV2 } from '../../shared/linkedinProfileV2';
import type { DownloadedMedia } from './candidateMedia';
import type { ResumeDraft } from './resumeDraft';
import { planResumeImport, type ResumeImportPlan } from './resumeImport';

/**
 * Adapts the wire contract into the shape `planResumeImport` already knows
 * how to turn into dossier evidence + a draft. The two types are kept
 * structurally identical on purpose (architecture §1/§2) so this function is
 * close to the identity — its only real job is supplying the `rawText` field
 * `ParsedResume` still requires but this route never uses (no text reader
 * runs on this path at all).
 */
function toParsedExperience(
  experience: LinkedInProfileV2['experience'],
): ParsedResume['experience'] {
  return experience.map((role) => ({
    title: role.title ?? '',
    employer: role.employer ?? '',
    location: role.location,
    startDate: role.startDate,
    endDate: role.endDate,
    current: role.current,
    responsibilities: [...role.responsibilities],
    achievements: [...role.achievements],
    employmentType: role.employmentType,
    workplaceType: role.workplaceType,
    skills: role.skills ? [...role.skills] : undefined,
    employerLogoSourceUrl: role.employerLogoSourceUrl,
    employerGroupKey: role.employerGroupKey,
  }));
}

function toParsedEducation(education: LinkedInProfileV2['education']): ParsedResume['education'] {
  return education.map((entry) => ({
    institution: entry.institution ?? '',
    qualification: entry.qualification,
    startDate: entry.startDate,
    endDate: entry.endDate,
    description: entry.description,
  }));
}

function toParsedRecommendations(
  recommendations: LinkedInProfileV2['recommendations'],
): ParsedResume['recommendations'] {
  return recommendations.map((item) => ({
    recommender: item.recommender,
    organization: item.organization,
    position: item.position,
    text: item.text,
    contact: item.contact,
    relationship: item.relationship,
    date: item.date,
  }));
}

export function linkedinProfileV2ToParsedResume(profile: LinkedInProfileV2): ParsedResume {
  return {
    fullName: profile.fullName,
    targetRole: profile.targetRole,
    headline: profile.headline,
    photoSourceUrl: profile.photoSourceUrl,
    about: profile.about,
    contact: {
      email: profile.contact.email,
      phone: profile.contact.phone,
      telegram: profile.contact.telegram,
      location: profile.contact.location,
      links: [...profile.contact.links],
      linkedinUrl: profile.contact.linkedinUrl,
    },
    experience: toParsedExperience(profile.experience),
    skills: [...profile.skills],
    education: toParsedEducation(profile.education),
    courses: profile.courses.map((course) => ({ ...course })),
    tests: profile.tests.map((test) => ({ ...test })),
    recommendations: toParsedRecommendations(profile.recommendations),
    languages: profile.languages.map((language) => ({ ...language })),
    additional: profile.additional,
    certifications: profile.certifications,
    projects: profile.projects,
    achievements: profile.achievements,
    openToWork: profile.openToWork,
    // No text ever went through a reader on this path; nothing reads this.
    rawText: '',
  };
}

export interface StructuredResumeImportOptions {
  readonly idPrefix: string;
}

/**
 * Builds the dossier evidence + v2 draft for a structured LinkedIn import.
 * Deliberately does not touch media: photo/logo bytes are resolved by the
 * caller (`resolveCandidateMedia`) before this runs, and attached afterwards
 * with `attachResumeMedia` — planning and downloading are different failure
 * domains and must not block one another (architecture §4).
 */
export function planStructuredResumeImport(
  profile: LinkedInProfileV2,
  options: StructuredResumeImportOptions,
): ResumeImportPlan {
  return planResumeImport(linkedinProfileV2ToParsedResume(profile), {
    idPrefix: options.idPrefix,
    schemaVersion: 2,
  });
}

/**
 * Wires downloaded media into the draft `planStructuredResumeImport` produced,
 * keyed by the exact source URL that `resolveCandidateMedia` was given. A URL
 * whose download failed or was rejected (SSRF, oversized, wrong magic bytes)
 * simply has no entry in `mediaBySourceUrl`, so the corresponding field stays
 * unset — a bad photo never fails the rest of the import.
 */
export function attachResumeMedia(
  draft: ResumeDraft,
  profile: LinkedInProfileV2,
  mediaBySourceUrl: ReadonlyMap<string, DownloadedMedia>,
): ResumeDraft {
  const photoMediaId = profile.photoSourceUrl
    ? mediaBySourceUrl.get(profile.photoSourceUrl)?.mediaId
    : undefined;
  // `planResumeImport` drops a role with neither a title nor an employer
  // before it ever becomes a draft entry (resumeImport.ts `planExperience`),
  // so the logo lookup has to apply the exact same filter — indexing the raw
  // `profile.experience` array positionally would misattach a logo the moment
  // any earlier role gets dropped.
  const keptLogoUrls = profile.experience
    .filter((role) => Boolean(role.title?.trim()) || Boolean(role.employer?.trim()))
    .map((role) => role.employerLogoSourceUrl);
  return {
    ...draft,
    candidate: {
      ...draft.candidate,
      ...(photoMediaId ? { photoMediaId } : {}),
    },
    experience: draft.experience.map((role, index) => {
      const sourceUrl = keptLogoUrls[index];
      const employerLogoMediaId = sourceUrl ? mediaBySourceUrl.get(sourceUrl)?.mediaId : undefined;
      return employerLogoMediaId ? { ...role, employerLogoMediaId } : role;
    }),
  };
}

/**
 * Deterministic JSON: object keys sorted recursively, so two structurally
 * identical profiles digest the same regardless of how their keys happened to
 * be ordered on the wire (idempotency, architecture §2).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sortKeysDeep((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/** Every media source URL referenced anywhere in a structured profile. */
export function collectMediaRequests(
  profile: LinkedInProfileV2,
): Array<{ kind: 'photo' | 'employer_logo'; sourceUrl: string }> {
  const requests: Array<{ kind: 'photo' | 'employer_logo'; sourceUrl: string }> = [];
  if (profile.photoSourceUrl) requests.push({ kind: 'photo', sourceUrl: profile.photoSourceUrl });
  for (const role of profile.experience) {
    if (role.employerLogoSourceUrl) {
      requests.push({ kind: 'employer_logo', sourceUrl: role.employerLogoSourceUrl });
    }
  }
  return requests;
}

/** Sections a structured LinkedIn read produces; courses/tests are not among them. */
const STRUCTURED_LIST_SECTIONS = [
  'experience',
  'education',
  'skills',
  'languages',
  'certifications',
  'projects',
  'recommendations',
  'achievements',
] as const;

/**
 * A LinkedIn details page can come back empty (lazy render, the 12 h read
 * throttle, a stopped walk). An empty section in a structured import then
 * means "not read", not "deleted": the candidate's existing entries stay
 * (B266) instead of the re-import wiping a filled profile.
 */
export function keepFilledSections(incoming: ResumeDraft, existing: ResumeDraft | undefined): ResumeDraft {
  if (!existing) return incoming;
  const kept = STRUCTURED_LIST_SECTIONS.filter(
    (section) => (incoming[section]?.length ?? 0) === 0 && (existing[section]?.length ?? 0) > 0,
  );
  return kept.reduce<ResumeDraft>((draft, section) => ({ ...draft, [section]: existing[section] }), incoming);
}
