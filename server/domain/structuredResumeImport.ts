import type { ParsedResume } from '../../src/features/workspace/resumeParser';
import type { LinkedInProfileV2 } from '../../shared/linkedinProfileV2';
import type { DownloadedMedia } from './candidateMedia';
import { MAX_BULLETS_PER_PLACE, type ResumeDraft } from './resumeDraft';
import { isImportedMemoryId, planResumeImport, type ResumeImportPlan } from './resumeImport';

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
    ...(profile.skillAssessments?.length
      ? { skillAssessments: [...profile.skillAssessments] }
      : {}),
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
export function keepFilledSections(
  incoming: ResumeDraft,
  existing: ResumeDraft | undefined,
): ResumeDraft {
  if (!existing) return incoming;
  // The target role is the candidate's choice and drives the campaign; an
  // import never clears it (B266: a re-import emptied it and the shortlist
  // fell back to the whole pool).
  const withRole: ResumeDraft = existing.targetRole
    ? { ...incoming, targetRole: existing.targetRole }
    : incoming;
  // A photo download can fail on any re-import (expired licdn link, timeout);
  // that must not blank the portrait the candidate already has (B266).
  const oldPhoto = existing.candidate?.photoMediaId;
  const withPhoto: ResumeDraft =
    oldPhoto && !withRole.candidate?.photoMediaId
      ? { ...withRole, candidate: { ...withRole.candidate, photoMediaId: oldPhoto } }
      : withRole;
  const withAbout = keepAbout(withPhoto, existing);
  const kept = STRUCTURED_LIST_SECTIONS.filter(
    (section) => (incoming[section]?.length ?? 0) === 0 && (existing[section]?.length ?? 0) > 0,
  );
  const withSections = kept.reduce<ResumeDraft>(
    (draft, section) => ({ ...draft, [section]: existing[section] }),
    withAbout,
  );
  const withSkills = kept.includes('skills')
    ? withSections
    : {
        ...withSections,
        skills: mergeReimportedSkills(incoming.skills ?? [], existing.skills ?? []),
      };
  const withFacts = kept.includes('experience')
    ? withSkills
    : {
        ...withSkills,
        experience: keepCandidateBullets(withSkills.experience, existing.experience),
      };
  return existing.declinedFactIds?.length
    ? { ...withFacts, declinedFactIds: existing.declinedFactIds }
    : withFacts;
}

function placeKey(entry: ResumeDraft['experience'][number]): string {
  return [entry.employer ?? '', entry.startDate ?? '']
    .map((part) => part.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase())
    .join('\u0000');
}

/**
 * A re-import replaces the imported bullets of each place, but the facts the
 * candidate accepted into it (C10) are not LinkedIn's to remove: they follow
 * the place, found by employer and start date. A place LinkedIn no longer has
 * leaves its facts unplaced, so they are offered again rather than lost.
 */
function keepCandidateBullets(
  incoming: ResumeDraft['experience'],
  existing: ResumeDraft['experience'],
): ResumeDraft['experience'] {
  const ownByPlace = new Map(
    existing.map((entry) => [
      placeKey(entry),
      (entry.bulletMemoryIds ?? []).filter((id) => !isImportedMemoryId(id)),
    ]),
  );
  return incoming.map((entry) => {
    const imported = entry.bulletMemoryIds ?? [];
    const own = (ownByPlace.get(placeKey(entry)) ?? []).filter((id) => !imported.includes(id));
    return own.length === 0
      ? entry
      : { ...entry, bulletMemoryIds: [...imported, ...own].slice(0, MAX_BULLETS_PER_PLACE) };
  });
}

/** A walk that did not see the About card is not a deleted summary (C7). */
function keepAbout(draft: ResumeDraft, existing: ResumeDraft): ResumeDraft {
  const oldAbout = existing.candidate?.about;
  if (!oldAbout || draft.candidate?.about) return draft;
  const aboutMemoryId = existing.candidate.aboutMemoryId;
  return {
    ...draft,
    candidate: { ...draft.candidate, about: oldAbout, ...(aboutMemoryId ? { aboutMemoryId } : {}) },
  };
}

type DraftSkill = NonNullable<ResumeDraft['skills']>[number];
const IMPORTED_SKILL_ID = /^imp[0-9a-f]{10}-skill-\d+$/u;

function skillKey(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

/**
 * The re-imported list replaces the imported one, but what the candidate did
 * outside LinkedIn stays (C13): a skill added by hand or by a quiz, and a
 * quiz verdict on a skill LinkedIn sends again without one.
 */
export function mergeReimportedSkills(
  incoming: readonly DraftSkill[],
  existing: readonly DraftSkill[],
): DraftSkill[] {
  const existingByKey = new Map(existing.map((skill) => [skillKey(skill.name), skill]));
  const merged = incoming.map((skill) => {
    const before = existingByKey.get(skillKey(skill.name));
    if (skill.status || !before?.status) return skill;
    const { status, source, verifiedAt } = before;
    return {
      ...skill,
      status,
      ...(source ? { source } : {}),
      ...(verifiedAt ? { verifiedAt } : {}),
    };
  });
  const incomingKeys = new Set(incoming.map((skill) => skillKey(skill.name)));
  const candidateOwned = existing.filter(
    (skill) => !IMPORTED_SKILL_ID.test(skill.id) && !incomingKeys.has(skillKey(skill.name)),
  );
  return [...merged, ...candidateOwned];
}
